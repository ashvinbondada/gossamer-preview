# Brief: Gossamer's webview can't resolve its own webview ID → all localhost fetches dead

**Status:** Open. Replaces the earlier diagnosis in `localhost-fetch-blocked-in-webview.md` (the "VS Code SW adds duplicate CORS header" theory was correct for healthy webviews, but does not apply here — the SW never resolves the webview at all).

**Severity:** Medium. Any HTML harness in Gossamer that needs to make outbound HTTP fails. Workaround: open the HTML in a regular browser tab via `http://localhost:7655/<page>.html`.

**Date:** 2026-06-06

---

## What I observed (from user-supplied console logs)

When the study HTML at `01-modal-product.html` is opened in Gossamer Preview and tries to `fetch("http://localhost:7655/ping")` from inside the srcdoc iframe, every request fails with this exact log sequence:

```
service-worker.js?v=4&… Could not resolve webview id
service-worker.js?v=4&… processLocalhostRequest
Access to fetch at 'http://localhost:7655/ping'
  from origin 'vscode-webview://1unsjucqfjc5n24vr0b0qrrlr4154jij9l2qvpu03m7mrpsrap5l'
  has been blocked by CORS policy:
  No 'Access-Control-Allow-Origin' header is present on the requested resource.
Uncaught (in promise) TypeError: Failed to fetch
  at processLocalhostRequest (service-worker.js:5042)
GET http://localhost:7655/ping net::ERR_FAILED
Fetch failed loading: GET "http://localhost:7655/ping".
```

The key line is **"Could not resolve webview id"**. This is logged from inside VS Code's webview service worker (`vscode-cdn.net/.../service-worker.js`) — *not* from our extension.

Tested in this order:

1. Helper server initially set `Access-Control-Allow-Origin: *`. Fetch from regular browser tab: works. From Gossamer: failed (presumed `*, *` duplicate per earlier brief).
2. Stripped all `Access-Control-Allow-*` headers from the server. Fetch from regular browser tab: works (same-origin). From Gossamer: **same "Could not resolve webview id" failure with "No 'Access-Control-Allow-Origin' header is present"** — meaning the SW is NOT adding its own header on this code path.

The earlier brief's hypothesis (SW always proxies localhost and adds CORS) is wrong for **our** webview class. The SW DOES intercept the fetch (the `Could not resolve webview id` log proves it ran), but its happy-path code that adds CORS to the proxied response only fires when it successfully resolves the webview ID — and ours never does.

So the iframe sees a CORS-failed response from the SW with no ACAO header, regardless of what our server sends.

## Why the webview ID can't be resolved (current best guess)

VS Code's webview SW maintains a registry mapping `webview ID → owning extension host context`. Entries are populated by VS Code when a webview is created and looked up when a request matches a webview's origin.

The failure shape suggests one of:

1. **Custom-editor webviews are registered differently from regular webview panels.** Gossamer uses `CustomTextEditorProvider` (see `src/customEditor.ts`), not `WebviewPanel.createWebviewPanel`. If the SW only sees panels, custom-editor webviews land in a different code path that never populates the registry.

2. **`srcdoc` iframe origin mismatch.** The outer webview has origin `vscode-webview://<id>`. The `srcdoc` iframe inside has origin `about:srcdoc` (or null). The SW's webview-ID resolution may look at the iframe's origin (null/srcdoc) rather than the parent webview origin, so the lookup misses.

3. **Custom editors created via `vscode.openWith` route through a different lifecycle** than `createWebviewPanel` and don't trigger the SW registry write.

Without VS Code internals source access (the SW comes from `vscode-cdn.net`, minified), the precise cause is best determined by experimenting against the working case.

## What works as a reference

The exact same HTML loaded at `http://localhost:7655/01-modal-product.html` in Cursor's built-in browser (or any external browser) works perfectly. So:

- The helper server is correct
- The HTML is correct (no `credentials: 'include'`, no `mode: 'no-cors'`)
- The Python `http.server` CORS behavior is fine

The break is purely Gossamer's webview hosting.

## What was tried and didn't work

1. **Inject permissive `<meta http-equiv="Content-Security-Policy">` in wrapped HTML.** Previous attempt — reintroduced the v2.1.0 window-reload hang. Reverted.

2. **Strip CORS headers from helper server.** Theory: SW would add its own. Reality (per above): SW never adds the header on this code path because it can't resolve the webview, so stripping ours just leaves us with a CORS-failed response and no ACAO at all.

3. **Re-add CORS headers to helper server.** Untested in *this* session post-diagnosis. May work if the SW's "could not resolve" path falls back to letting the browser inspect the response directly — in which case our `*` would satisfy the browser. Worth trying first, low cost.

## Suggested directions to investigate

### Direction 1: re-add CORS, see what happens (cheapest)

If the SW's "could not resolve" path proxies-without-modifying the response, our `Access-Control-Allow-Origin: *` may be visible to the browser and CORS would pass. This is the cheapest experiment — re-add CORS to the helper server, hit Submit, observe what the console says.

If the failure becomes the duplicate-`*, *` from the earlier brief, then the SW DOES add a header on this path too and we're stuck.
If the failure stays "no ACAO", the SW is fully blocking the response and we need a different approach (Direction 2 or 3).

### Direction 2: `localResourceRoots` / `portMapping` on the webview

VS Code webviews accept `portMapping` in `WebviewOptions` that lets you declare which localhost ports should be accessible from inside the webview. This may be the supported API for exactly this use case.

```ts
panel.webview.options = {
  enableScripts: true,
  portMapping: [{ webviewPort: 7655, extensionHostPort: 7655 }],
};
```

The fetch from inside the iframe would then go through VS Code's official tunneling instead of the raw localhost path. Try this first if Direction 1 fails.

Note: `portMapping` may rewrite URLs to `https://<extensionId>-webview.<id>.vscode-webview.net/<port>/...` — the user HTML would need to know to fetch from that rewritten URL, which breaks the "this HTML works in any browser" property. Need to investigate whether the SW rewrites them transparently or whether the page must use the rewritten URL.

### Direction 3: same-origin proxy through Gossamer's live-reload server (port 7654)

The user HTML is served with `<base href="http://localhost:7654/">`. So a fetch to `/save` (relative) goes to port 7654 — Gossamer's own live-reload server. Add a proxy route there that forwards `/study-proxy/save` to `http://localhost:7655/save` (or any port the user declares via a `<meta name="gossamer-proxy" content="7655">` opt-in).

User HTML changes one line: `fetch("/study-proxy/save", ...)` instead of `fetch("http://localhost:7655/save", ...)`. Same-origin from the iframe's perspective, no CORS, no SW games.

Downside: the user HTML now has a Gossamer-specific path that won't work in a plain browser unless we also add a `<base>` fallback or document the convention.

### Direction 4: `window.gossamer` bridge

Inject a small `window.gossamer.fetch(url, opts)` API into wrapped HTML. It posts the request to the parent webview via `postMessage`, the parent forwards to the extension host via `onDidReceiveMessage`, the extension host makes the actual outbound HTTP call, and the response is relayed back. Bypasses SW + CORS entirely because the network call doesn't happen in browser context.

Largest surface area to build. Most robust because it doesn't depend on any specific VS Code webview behavior.

## Acceptance criteria

- A previewed HTML page calling `fetch("http://localhost:7655/save", { method: "POST", headers: {"Content-Type": "application/json"}, body: "..." })` succeeds when opened in Gossamer Preview.
- **Window reload (Cmd+R) still completes in < 1 second.** This was broken by the previous CSP-injection attempt — mandatory regression check.
- Toolbar reload (⟳) still re-hydrates the iframe.
- Live-reload WebSocket still connects from inside the iframe.
- Existing inline scripts/styles in user HTML continue to work.

## Reproducer

```bash
cd ~/modal-sys-design
python3 study/server.py
```

Open `~/modal-sys-design/study/01-modal-product.html` in Gossamer Preview. Type anything in the textarea on Q1, hit Submit. Observe console errors (open via Cmd+Opt+I if Gossamer allows; otherwise reproduce in plain browser at `http://localhost:7655/01-modal-product.html` to confirm the same page works there).

Console will log "Could not resolve webview id" repeatedly from the SW.

## Notes for the agent that picks this up

- Read `docs/briefs/localhost-fetch-blocked-in-webview.md` first for historical context, but **the diagnosis in that file is partially wrong** (specifically the "SW always adds CORS so don't set your own" guidance). This brief supersedes it.
- The previous CSP-injection attempt is in git history if you want to see what NOT to do. It's the commit that introduced and reverted changes to `src/previewHtml.ts:wrapWithBase()`.
- The user is on a tight timeline (interview tomorrow) and is using the regular-browser workaround. **Do not break the workaround** — fixing this should add a path that works in Gossamer without regressing the same HTML opening in a normal browser.
- Test page suggestion: write `docs/mockups/localhost-fetch-test.html` with both a GET and POST button against `http://localhost:7655`. Use it for manual + (eventually) automated regression checks.
- The user explicitly does not want a Gossamer code change that adds a CSP injection — last attempt broke reload and they lost trust.

## Files of interest

- `src/customEditor.ts:54` — `panel.webview.options = { enableScripts: true }`. This is where `portMapping` would go (Direction 2).
- `src/customEditor.ts:102` — where the wrapped HTML is posted to the iframe as srcdoc.
- `src/previewHtml.ts:wrapWithBase` — where injection-based approaches would land (don't reuse the CSP approach).
- `src/liveReload.ts:injectReloadScript` — the existing live-reload script injection, would be the model for Direction 4.
