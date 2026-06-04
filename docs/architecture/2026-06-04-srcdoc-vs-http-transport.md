# Architecture Decision: srcdoc/postMessage transport (and removal of the WebSocket server)

> Generated: 2026-06-04

## Status

Accepted. Supersedes the WebSocket-based live-reload transport described in
`2026-05-11-live-reload-and-diff-view-architecture.md`.

## Context

The original live-reload design served previewed HTML from a local Node `http`
server and pushed reload signals to the preview over a **WebSocket** (the
"Commandments" in the 2026-05-11 doc codify this). The preview itself fetched
its content over `http://127.0.0.1:7654/<file>` and ran a WebSocket client that
called `location.reload()` when the server said so.

This caused a severe, user-visible bug in Cursor: **window reloads hung for
30–60 seconds.** Root cause — when the webview (and its iframe) is torn down,
Cursor's webview disposal *awaits the WebSocket close handshake*. The browser
does not reliably propagate the TCP FIN promptly while an iframe is being
destroyed, so the close never completes within a reasonable time, and the
extension host can't terminate cleanly until it does.

## Decision

Move content delivery and reload signalling **off HTTP-fetch + WebSocket and
onto `postMessage` + iframe `srcdoc`**:

1. The preview iframe is rendered with `src="about:blank"` — **no network load.**
2. The extension pushes the file's HTML to the webview via
   `panel.webview.postMessage({ type: 'gossamer-srcdoc', html })`, and the
   webview assigns it to the iframe as `srcdoc`.
3. Relative asset URLs still resolve because `wrapWithBase()` injects a
   `<base href="http://127.0.0.1:<port>/">` pointing at the local HTTP server.
4. Reload is just another `postMessage` (`gossamer-reload`) — the iframe calls
   `location.reload()`. No socket, no handshake, nothing to await on teardown.

`postMessage` has no teardown semantics: when the webview goes away, messages
simply stop being delivered. There is nothing for Cursor's disposal to block on.

## What the HTTP server still does

The local `http` server (`LiveReloadServer`) is **retained**, but its role is now
narrow:

- Serves the registered HTML file so the injected `<base href>` can resolve
  relative links between previewed HTML files.
- Allows a developer to open `http://127.0.0.1:7654/<file>` directly in an
  external browser for a static view.

It is **not** on the critical path for the in-editor preview or its auto-reload
— those are entirely `postMessage`-driven.

## The WebSocket server was removed (2026-06-04)

After the migration, the hand-rolled WebSocket server (raw frame encoding in
`liveReload.ts`) served exactly one purpose: live-reload for a standalone
external browser tab opened directly at `localhost:7654`. In-editor previews
never touched it.

Given it was ~70 lines of fragile hand-rolled protocol code (plus its test
suite) for an undocumented edge case — and that it was the *same mechanism*
whose teardown caused the original hang — it was removed. Consequence:

- **In-editor preview and auto-reload: unchanged.** They use `postMessage`.
- **External browser opened directly at `localhost:7654`: still served
  statically, but no longer auto-reloads.**

## Trigger condition / when to revisit

This whole `srcdoc` detour exists to work around Cursor's webview-disposal
behavior. If a future Cursor/VS Code release disposes webviews without awaiting
in-flight socket closes, the indirection (srcdoc hydration via postMessage,
`<base href>` rewriting) could be reconsidered in favour of a plain
iframe `src` load. Until then, **do not reintroduce a socket-based transport on
the webview teardown path.**

## Related cleanup (2026-06-04)

The reload-hang investigation left heavy forensic instrumentation in the
shipped code. With the hang resolved, the following were removed:

- The 500ms heartbeat timer and the active-handle/request snapshots and
  watchdog timers in `extension.ts` (`activate`/`deactivate`/dispose).
- The `SKIP_IFRAME_DIAGNOSTIC` dead branch in `customEditor.ts`.
- The dev-only `__iframeMark` perf plumbing and unconditional
  `gossamer-iframe-log` debug `postMessage`s in the injected iframe script, plus
  the now-orphaned parent-side `gossamer-iframe-log` / `gossamer-perf` handlers.
- The `console.log` `dbg()` scaffolding in `LiveReloadServer.start`/`dispose`.

The gated, zero-overhead dev instrumentation (`perf.ts`, and the
`PERF_OVERLAY_ENABLED` / `CLIPBOARD_DEBUG_ENABLED` overlays in `previewHtml.ts`)
was intentionally kept — it compiles to no-ops in shipped builds and remains
useful for local debugging.
