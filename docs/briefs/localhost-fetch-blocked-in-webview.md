# Brief: Previewed HTML can't fetch() arbitrary localhost ports

**Status:** Open. Not blocking the v2.1.4 release. Surfaced 2026-06-06 while building an interactive study harness that POSTs answers to a local Python server.

**Severity:** Medium. Affects any HTML harness that wants to make outbound HTTP calls (interactive forms, mock APIs, dev playgrounds, the `interactive-study-session` skill pattern). Workaround exists (open the page in a regular browser tab).

---

## Use case

Author writes an HTML page that POSTs JSON to a local helper server, e.g.:

```js
await fetch("http://localhost:7655/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ answer: "..." }),
});
```

The helper server runs on a port the author picks (7655 here — 7654 is owned by Gossamer's live-reload server). The page is opened via Gossamer Preview.

The author expects the page to behave the way it does in any normal browser tab: the fetch goes out, the helper server writes a file, the page proceeds.

## Problem

In Gossamer Preview, `fetch()` to `http://localhost:7655/*` fails immediately with:

```
TypeError: Failed to fetch
```

No network request reaches the server (confirmed via server-side logging). The failure is browser-side, before the request leaves the iframe.

The same HTML file, opened in Cursor's built-in browser tab at `http://localhost:7655/<page>.html`, works perfectly. So the issue is specific to Gossamer's webview rendering, not the page or the helper server.

## Architecture context (so you know what you're working with)

- Gossamer Preview registers a CustomTextEditor (`src/customEditor.ts → GossamerHtmlEditor`).
- On `resolveCustomTextEditor`, it sets `panel.webview.options = { enableScripts: true }` — note: **no `localResourceRoots`, no CSP override.**
- It then calls `panel.webview.html = buildHtml(previewUrl, ...)` which renders a toolbar shell containing `<iframe id="frame" src="about:blank" data-base-href="...">`.
- It posts the raw user HTML as a `srcdoc` payload via `panel.webview.postMessage({ type: 'gossamer-srcdoc', html: wrapped })`.
- The parent webview script (in `src/previewHtml.ts`, see message handler for `gossamer-srcdoc`) assigns `frame.srcdoc = msg.html`.
- `wrapWithBase()` injects a `<base href="http://localhost:7654/...">` into the user HTML so relative asset URLs resolve against the live-reload server.

So the iframe content has:
- Origin: opaque/`null` (srcdoc origin)
- `<base href="http://localhost:7654/">` set explicitly
- Whatever CSP the VS Code webview applies by default (we don't set one)

## Why "Failed to fetch" — best guess

VS Code's default webview CSP is strict. When a page inside the webview tries to `fetch()` a URL outside the webview's `cspSource`, the request is blocked at CSP-check time before it even hits the network. Hence the immediate failure with no server-side log.

The iframe being `srcdoc`-loaded probably inherits some of the parent's CSP behavior even though srcdoc usually gets an opaque origin with its own CSP context — the precise inheritance rules in VS Code webviews are not well documented.

## Goal

Allow previewed HTML to `fetch()` `http://localhost:*` and `http://127.0.0.1:*` without breaking:

- Window reload (the historical hang fixed in v2.1.0 — see `CHANGELOG.md` "Window reload no longer hangs")
- Live reload via `injectReloadScript` (currently uses WebSocket to localhost:7654)
- The toolbar postMessage protocol (host-key forwarding, find, copy, reload button, srcdoc hydration, debug-log, etc.)
- Existing inline `<style>` and inline `<script>` in user HTML (Gossamer is a preview tool — users expect their pages to "just work")

## Approach that was attempted and broke things

A naive fix was tried: inject a permissive `<meta http-equiv="Content-Security-Policy">` tag into the wrapped HTML inside `wrapWithBase()`:

```ts
const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* http://127.0.0.1:* https:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* https:; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline' https: http:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:;">`;
```

**Result:**
1. It is unclear whether this even fixed the `fetch` block — the user did not get a chance to test before:
2. **It reintroduced the window-reload hang** that v2.1.0's CHANGELOG explicitly fixed (`Window reload no longer hangs.`). The user reported the hang immediately after installing the patched build.

This was reverted in the same session. **Do not re-attempt this exact patch without first understanding what the v2.1.0 reload fix depends on.**

Relevant memory entries:

- `~/.claude/projects/-Users-mystiquant-gossamer-preview/memory/project_hang_dispose_wrong.md` — past attempts to fix the reload hang and why several theories were wrong
- `CHANGELOG.md` v2.1.0 release notes — the fix was switching to `srcdoc + postMessage` hydration to kill the slow HTTP fetch path on disposal

## What to investigate

1. **Where exactly the fetch is being blocked.** Devtools console message from inside the iframe is the ground truth — is it a CSP violation, a Cross-Origin error, a network error? The user could not open devtools inside Gossamer; you'll need a way to surface this (e.g. inject a debug script that prints `navigator.userAgent`, the iframe's effective CSP from `document.contentSecurityPolicy` if available, and the actual fetch error to a visible overlay).

2. **Why the meta-CSP injection broke window reload.** This is the most suspicious thing. Hypothesis: the inline CSP `default-src` is overriding something the parent webview script (the toolbar shell, NOT the user's content) relies on for the message protocol — but the toolbar shell isn't in the iframe, so this shouldn't affect it. Maybe the inner page's reload-script (`injectReloadScript`) does something CSP-sensitive. Test: inject the CSP but log into `gossamer-iframe-log` (the existing host-relay channel) to see what's happening.

3. **Whether the VS Code webview itself sets a Content-Security-Policy response header on the iframe content.** If so, the meta tag inside the user HTML is irrelevant — we need to set it via `panel.webview.options` or via the response headers of how `srcdoc` is interpreted (which is more limited).

4. **Alternatives to CSP-injection:**
   - Add an opt-in marker the user HTML can include: `<meta name="gossamer-allow-localhost" content="true">`. Only when present does Gossamer attempt to broaden the CSP. Reduces blast radius.
   - Proxy the user's fetches through Gossamer's existing live-reload server (port 7654). The user HTML calls `/gossamer-proxy/save` (same origin as the `<base href>`), Gossamer's server forwards to `localhost:7655`. No CSP work needed in the page.
   - Provide a Gossamer-native API surfaced via `window.gossamer.fetch(url, opts)` that bridges over `postMessage` to the extension host, which makes the actual outbound call.

## Acceptance criteria

- A previewed HTML page calling `fetch("http://localhost:7655/save", { method: "POST", ... })` succeeds — the helper server receives the request, returns a JSON response, the page reads the response.
- Window reload (Cmd+R) still completes in < 1 second. **Mandatory regression check.** Use the reload-monitoring described in `memory/project_hang_dispose_wrong.md` if it's not already wired up.
- The in-preview reload button (toolbar ⟳) still re-hydrates the iframe.
- The live-reload WebSocket on 7654 still connects from inside the iframe.
- Existing visual styling, inline scripts, and inline event handlers in user HTML continue to work.
- A test page is checked in at `docs/mockups/localhost-fetch-test.html` that:
  - GETs `http://localhost:7655/ping` on load (or shows "server not running" if not)
  - has a button that POSTs to `http://localhost:7655/save` with a small JSON body
  - displays the response inline
- An automated test added under `test/integration/` that opens the test page and asserts the GET and POST both succeed when a stub server is running on 7655.

## Reproducing

A minimal repro server is at `~/modal-sys-design/study/server.py` — run `python3 ~/modal-sys-design/study/server.py` and open `~/modal-sys-design/study/01-modal-product.html` in Gossamer Preview. Hit Submit. You'll see `TypeError: Failed to fetch`. Open the same file at `http://localhost:7655/01-modal-product.html` in Cursor's regular browser tab — Submit works.

## Out of scope

- Auth, credentials, cookies — the failure happens before any of that matters.
- Production deployments. This is a developer-experience issue for HTML harnesses authored alongside the agent.
- Generalizing to arbitrary hosts — `http://localhost:*` and `http://127.0.0.1:*` is the scope.

---

## 2026-06-06 update: actual diagnosis (from user-supplied console output)

The "Why — best guess" section above was wrong. The real failure mode came out
when the user grabbed the browser console inside Cursor's webview while
submitting:

```
service-worker.js → processLocalhostRequest
Access to fetch at 'http://localhost:7655/save' from origin 'vscode-webview://...'
has been blocked by CORS policy: Response to preflight request doesn't pass
access control check: The 'Access-Control-Allow-Origin' header contains
multiple values '*, *', but only one is allowed.
```

What's actually happening:

1. **VS Code's webview ships a service worker** (`service-worker.js`) that
   intercepts `fetch()` for `http://localhost:*` and proxies it on behalf of
   the webview. This is the same mechanism that powers
   `webview.asWebviewUri(localhost-url)` — built into VS Code, not anything
   Gossamer configures. **There is no CSP block.**
2. **GET requests work** because they're "simple" CORS requests with no
   preflight.
3. **POST requests with `Content-Type: application/json` trigger a preflight**
   (the OPTIONS request you see). The VS Code SW appends an
   `Access-Control-Allow-Origin: *` header to its proxied response, **and** the
   user's stub server already sets the same header. The browser sees the
   header value `*, *` and rejects.
4. **The same page works in a regular browser tab** because no service worker
   is intercepting — the request goes direct to the stub, exactly one CORS
   header.

### Implication for the brief's `Goal` section

- "Allow previewed HTML to fetch localhost" — already works. VS Code's webview
  SW handles it. Nothing for Gossamer to do.
- The "Failed to fetch" the user originally reported was the
  preflight-rejection-then-network-error chain, not a CSP block.

### What v2.1.4 should actually ship

Either of these makes the canonical user pattern work without any Gossamer
code change:

**(a) Tell users to not send `Access-Control-Allow-Origin: *` from their helper
servers when running under Gossamer.** VS Code's SW adds it; the user
shouldn't. This is documentation, not code. The shipped
`docs/mockups/localhost-fetch-stub.py` is a counter-example today — it sets
the duplicate header and would fail. Fix the docs/sample, mention in README.

**(b) Inject a tiny fetch shim into wrapped HTML** that strips
`Access-Control-Allow-Origin` from outgoing requests — actually no, the
duplicated header is on the *response*; the shim can't fix that.

**(c) Bypass the SW entirely with a same-origin proxy.** Add a
`/gossamer-proxy/<port>/<path>` route on the existing port-7654 server that
forwards to `localhost:<port>`. User code calls
`fetch("/gossamer-proxy/7655/save", ...)` — same origin as the iframe's
`<base href>`, no SW interception, no CORS at all. Best UX, but new surface
to maintain.

Recommendation: ship (a) immediately (one-line README addition + fix the
sample server), file (c) as a follow-up enhancement.

### How this was diagnosed

`src/test/integration/suite/localhostFetch.test.ts` opens the test page via
`vscode.openWith(uri, 'gossamer-preview.html')`, posts a `gossamer-test-fetch`
message into the panel, and asserts the result message comes back successful.
Run with `npm run test:integration` (vanilla Code) or
`npm run test:integration:cursor` (real Cursor binary). All 17 tests pass
against both — including the POST + JSON case — because the in-test stub
server uses a single CORS header. To reproduce the bug as the user saw it,
the stub would need to mirror the user's permissive-but-duplicated header
emission AND run on a port the user's webview tries to proxy. This will be
captured as a separate `it()` once we have a stable repro path for the
two-header case.

### Reload regression check

The integration test also includes a hard guard that re-opens the panel four
times in a row and asserts each resolve is < 1500ms. This is the test bed any
future fix should pass. See `memory/feedback_deactivate_must_not_block.md`
and `CHANGELOG.md` v2.1.0.
