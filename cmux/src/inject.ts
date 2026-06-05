// Live-reload client injected into every previewed HTML page the gossamer-cmux
// server serves. Unlike the VS Code extension build, the page here loads in
// cmux's REAL embedded browser (a Chromium surface), so we use a plain
// EventSource (Server-Sent Events) connection back to the daemon. When the
// daemon detects a file change it pushes "reload" down the stream and we reload
// the page in place.
//
// We deliberately do NOT inject the extension's find/zoom/host-key toolbar:
// cmux's browser chrome already provides Cmd+F find, zoom, back/forward, reload
// and a URL bar natively. The previewed page stays untouched except for this
// tiny client.

export function reloadClientScript(urlPath: string): string {
  return `<script data-gossamer-livereload>
(function () {
  var URLPATH = ${JSON.stringify(urlPath)};
  var SS_KEY = '__gossamer_scroll__:' + URLPATH;

  // Restore scroll position saved just before the previous reload, so editing a
  // long document doesn't bounce the viewport back to the top on every change.
  try {
    var y = sessionStorage.getItem(SS_KEY);
    if (y !== null) {
      window.addEventListener('load', function () {
        window.scrollTo(0, parseInt(y, 10) || 0);
        try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
      });
    }
  } catch (e) {}

  function reload() {
    try { sessionStorage.setItem(SS_KEY, String(window.scrollY || window.pageYOffset || 0)); } catch (e) {}
    location.reload();
  }

  function connect() {
    var es;
    try {
      es = new EventSource('/__gossamer/events?u=' + encodeURIComponent(URLPATH));
    } catch (e) { setTimeout(connect, 1000); return; }
    es.onmessage = function (ev) { if (ev.data === 'reload') reload(); };
    // EventSource auto-reconnects on transient errors. Only when it gives up
    // permanently (readyState CLOSED, e.g. the daemon went away) do we close it
    // and retry on a backoff so the page re-attaches when the daemon returns.
    es.onerror = function () {
      if (es.readyState === 2 /* CLOSED */) {
        try { es.close(); } catch (e) {}
        setTimeout(connect, 1500);
      }
    };
  }
  connect();
})();
</script>`;
}

// Insert the client just before </body> (falling back to </html>, then append).
export function injectReloadClient(html: string, urlPath: string): string {
  const script = reloadClientScript(urlPath);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, script + '</body>');
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, script + '</html>');
  return html + script;
}
