# Changelog

## [2.1.0] — Major UX rewrite

A near-total rebuild of the preview toolbar and how shortcuts interact with the previewed content. If you've been hitting any of the rough edges in 2.0.x — Find not working, Cmd+P not opening Quick Open from inside the preview, Cursor hanging on window reload — they're all fixed here.

### ✨ New

- **Floating glass toolbar.** Redesigned chrome — auto-dims after 2.2s of inactivity, wakes with a warm orange gradient sweep on the pill border when you move your cursor over the preview.
- **Expanding Find pill.** Cmd/Ctrl+F smoothly stretches the toolbar to fit a search field. Two-stage Esc: first press clears your query, second press closes. Session-local history of recent searches with arrow-key navigation. Find works whether focus is on the toolbar or inside the rendered page.
- **VS Code shortcuts work inside the preview iframe.** Cmd/Ctrl+P (Quick Open), Cmd/Ctrl+Shift+P (Command Palette), Cmd/Ctrl+S (Save), Cmd/Ctrl+W (Close), Cmd/Ctrl+B (Sidebar), Cmd/Ctrl+\` (Terminal) — all forward to VS Code even when your cursor is in the previewed page content.
- **Copy with Cmd/Ctrl+C from the preview.** Select text in the rendered HTML and copy it to your clipboard.
- **Copy relative path button.** Click the filename badge in the toolbar to copy the workspace-relative path to your clipboard (the URL bar is gone).
- **Skeleton loader on first paint.** Soft shimmer placeholder shows immediately when the preview opens, instead of a brief blank flash.

### 🐛 Fixed

- **Find no longer silently fails.** The in-page search broke in 2.0.4 because of the cross-origin iframe — it now works reliably via a `postMessage` protocol.
- **Window reload no longer hangs.** Previously the iframe's HTTP fetch was triggering a 10–60 second wait in Cursor's webview disposal when you reloaded the window. Switched the preview to inline `srcdoc` hydration over `postMessage`, killing the slow path entirely.
- **Extension activation is bulletproof.** A defensive `deactivate()` and lazy SDK loads mean activation can never hang the editor or block reload.

### ⚙️ Under the hood

- Anonymous usage and error telemetry (PostHog). See [PRIVACY.md](PRIVACY.md) for the complete list of what's collected. Set `gossamer-preview.telemetry.enabled` to `false`, or turn off `telemetry.telemetryLevel` globally, to opt out.
- Comprehensive jsdom-based unit test suite (125 tests).

## [2.0.3]

- Edit Source button is now a toggle — click once to open the source editor beside the preview, click again to close it
- Added in-editor update notifications — a banner appears after each update with a link to the changelog

## [1.2.0]

- Fixed port to `7654` so Simple Browser tabs survive Cursor restarts
- Each HTML file now gets its own URL (`/filename.html`) with independent live reload
- Fixed live reload not triggering on auto-save (now detects every edit, not just Cmd+S)
- Fixed first-open bug where Simple Browser wouldn't open on the very first HTML file

## [1.1.0]

- Added live reload via WebSocket — browser updates automatically as you edit
- Switched from file:// to HTTP server so reload and scripting work correctly

## [1.0.0]

- Initial release
- Auto-opens Simple Browser when an HTML file is opened
- Closes the raw editor tab by default (`gossamer-preview.openEditor` to keep it open)
