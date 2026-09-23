// Pure data, no vscode import — so unit tests can import directly without a
// VS Code runtime. localhostPorts.ts re-exports this and layers the vscode
// settings lookup on top.
//
// Curated list of common localhost ports. Anything in this list is reachable
// from previewed HTML via `fetch("http://localhost:<port>/...")` because we
// declare `portMapping` entries for each one when constructing the webview.
//
// Without portMapping, VS Code's webview service worker fails to resolve the
// webview ID and blocks every localhost response with a CORS error — even for
// servers that set Access-Control-Allow-Origin: *. portMapping is the
// official API for this case; see the WebviewOptions docs.
//
// portMapping does NOT support websockets per the docs. The live-reload WS on
// 7654 is unaffected because the iframe connects via the <base href>, not a
// hardcoded ws://localhost URL.
export const DEFAULT_LOCALHOST_PORTS: readonly number[] = Object.freeze([
  3000, 3001, 3030,            // node / express / vite defaults
  4000, 4173, 4200,            // various frameworks
  5000, 5050, 5173, 5174,      // flask, vite
  6006,                        // storybook
  7654,                        // our own live-reload server
  7655,                        // study-session helper, the original repro port
  8000, 8001, 8080, 8081, 8888,
  9000, 9090,
]);
