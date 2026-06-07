import * as http from 'http';
import * as fs from 'fs';
import { captureException } from './posthog';

const INJECTED = `
<style>
:root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
</style>
<script>
(function() {
  // Live reload via postMessage from parent webview — NOT WebSocket.
  // The old WebSocket-based reload was the root cause of window-reload hangs:
  // Cursor's webview disposal awaited the ws.close handshake, which could
  // take 30-60 seconds because the browser doesn't always propagate FIN
  // promptly when an iframe is being torn down. postMessage has no such
  // teardown semantics; it just stops being delivered.
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'gossamer-reload') {
      location.reload();
    }
  });

  var HL = '__gossamer_hit__';
  var ACTIVE = '__gossamer_hit_active__';
  var matches = [];
  var currentIndex = -1;
  var lastSeq = 0;

  function ensureStyle() {
    if (document.getElementById('__gossamer_find_style__')) return;
    var style = document.createElement('style');
    style.id = '__gossamer_find_style__';
    style.textContent =
      '.' + HL + ' { background: #ffd54f; color: #000; }' +
      '.' + ACTIVE + ' { background: #ff9800; color: #000; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function clearMatches() {
    var marks = document.querySelectorAll('mark.' + HL);
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
    matches = [];
    currentIndex = -1;
  }

  function postResult(seq) {
    parent.postMessage({
      type: 'gossamer-find-result',
      seq: seq,
      total: matches.length,
      current: matches.length === 0 ? 0 : currentIndex + 1
    }, '*');
  }

  function focusMatch(i, seq) {
    if (matches.length === 0) { postResult(seq); return; }
    if (currentIndex >= 0 && matches[currentIndex]) matches[currentIndex].classList.remove(ACTIVE);
    currentIndex = (i + matches.length) % matches.length;
    var m = matches[currentIndex];
    m.classList.add(ACTIVE);
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    postResult(seq);
  }

  function runSearch(query, seq) {
    ensureStyle();
    clearMatches();
    if (!query) { postResult(seq); return; }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    var q = query.toLowerCase();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var idx = lower.indexOf(q);
      if (idx < 0) continue;
      var parent = node.parentNode;
      var cursor = 0;
      var frag = document.createDocumentFragment();
      while (idx >= 0) {
        if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
        var mark = document.createElement('mark');
        mark.className = HL;
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        matches.push(mark);
        cursor = idx + q.length;
        idx = lower.indexOf(q, cursor);
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      parent.replaceChild(frag, node);
    }
    if (matches.length > 0) {
      currentIndex = -1;
      focusMatch(0, seq);
    } else {
      postResult(seq);
    }
  }

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'gossamer-find') {
      if (msg.seq < lastSeq) return;
      lastSeq = msg.seq;
      runSearch(msg.query || '', msg.seq);
    } else if (msg.type === 'gossamer-find-nav') {
      focusMatch(currentIndex + (msg.direction || 1), msg.seq || 0);
    } else if (msg.type === 'gossamer-find-clear') {
      clearMatches();
    }
  });

  // Iframe-side keydown listener — handles three classes of chords:
  //
  //  1) Toolbar chords (Cmd+F/=/+/-/0) — forwarded to parent as 'gossamer-key'.
  //     Parent triggers our own Find/zoom UI.
  //  2) Iframe-native chords (Cmd+C/V/X/A/Z/Y) — NOT intercepted. The browser
  //     handles copy/paste/undo natively against the iframe's selection.
  //  3) Everything else with a modifier (Cmd+P, Cmd+S, Cmd+W, Cmd+B, etc.) —
  //     forwarded to parent as 'gossamer-host-key', which relays to the
  //     extension host so VS Code executes the corresponding command. This is
  //     what lets Cmd+P open Quick Open even when focus is inside this iframe.
  //
  // Plain unmodified keys (typing, arrows, Tab, etc.) are always left alone.
  var TOOLBAR_KEYS = ['f', '=', '+', '-', '0'];
  document.addEventListener('keydown', function(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    var key = (e.key || '').toLowerCase();

    // Cmd+C / Cmd+X: the cross-origin iframe in a vscode-webview is in a weird
    // permission state where navigator.clipboard often fails silently. Solution:
    // read the iframe's selection, send the text up to the parent webview, and
    // let the PARENT (which has full clipboard permission in vscode-webview://)
    // do the actual write. Also delete the selection here for cut.
    if (key === 'c' || key === 'x') {
      var sel = window.getSelection();
      var text = sel ? sel.toString() : '';
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        parent.postMessage({ type: 'gossamer-clipboard-write', text: text }, '*');
        if (key === 'x' && sel && sel.deleteFromDocument) {
          try { sel.deleteFromDocument(); } catch (err) {}
        }
      }
      return;
    }

    // Cmd+V / Cmd+A / Cmd+Z / Cmd+Y: leave the browser's native handler alone.
    // These act on input fields or selection inside the iframe and need no help.
    if (key === 'v' || key === 'a' || key === 'z' || key === 'y') return;

    if (TOOLBAR_KEYS.indexOf(key) >= 0) {
      e.preventDefault();
      parent.postMessage({ type: 'gossamer-key', key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, '*');
      return;
    }
    // Forward to host. The parent webview will relay to the extension host,
    // which dispatches to the matching VS Code command via a hardcoded map.
    e.preventDefault();
    parent.postMessage({
      type: 'gossamer-host-key',
      key: e.key, code: e.code,
      metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey
    }, '*');
  }, false);
})();
</script>
`;

export function injectReloadScript(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', INJECTED + '</body>');
  }
  return html + INJECTED;
}

export class LiveReloadServer {
  private server: http.Server;
  private fileMap: Map<string, string> = new Map(); // urlPath -> fsPath
  private bufferText: Map<string, string> = new Map(); // fsPath -> in-memory editor text
  public port = 0;

  // Returns the live HTML content for an fs path: in-memory editor buffer if
  // the user has unsaved edits, otherwise reads from disk. Returns the RAW
  // file content (no live-reload script injection — that's only for the
  // HTTP server path used by external browsers). Used by the srcdoc-based
  // iframe to assign content directly without going through HTTP.
  getRawHtml(fsPath: string): string {
    const buffered = this.bufferText.get(fsPath);
    if (buffered !== undefined) return buffered;
    return fs.readFileSync(fsPath, 'utf8');
  }

  setBufferText(fsPath: string, text: string) {
    this.bufferText.set(fsPath, text);
  }

  clearBufferText(fsPath: string) {
    this.bufferText.delete(fsPath);
  }

  // Returns the URL path for a given fs path, registering it if new.
  registerFile(fsPath: string): string {
    for (const [urlPath, registeredPath] of this.fileMap) {
      if (registeredPath === fsPath) return urlPath;
    }
    const urlPath = '/' + encodeURIComponent(require('path').basename(fsPath));
    this.fileMap.set(urlPath, fsPath);
    return urlPath;
  }

  constructor() {
    this.server = http.createServer((req, res) => {
      const urlPath = req.url?.split('?')[0] ?? '/';
      const fsPath = this.fileMap.get(urlPath);
      if (!fsPath) {
        res.writeHead(404);
        res.end('No file loaded for this path');
        return;
      }
      try {
        const html = this.bufferText.get(fsPath) ?? fs.readFileSync(fsPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        });
        res.end(injectReloadScript(html));
      } catch (err) {
        captureException(err, { context: 'file_read', url_path: urlPath });
        res.writeHead(500);
        res.end('Error reading file');
      }
    });
  }

  start(): Promise<number> {
    const PREFERRED_PORT = 7654;
    const STARTUP_TIMEOUT_MS = 3000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (port: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(port);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        reject(err);
      };

      const timeoutHandle = setTimeout(() => {
        fail(new Error('LiveReloadServer.start timed out after ' + STARTUP_TIMEOUT_MS + 'ms'));
      }, STARTUP_TIMEOUT_MS);

      const onListen = () => {
        const addr = this.server.address() as { port: number } | null;
        if (!addr) { fail(new Error('server.address() returned null after listen')); return; }
        this.port = addr.port;
        done(this.port);
      };

      const tryFallback = () => {
        this.server.removeAllListeners('error');
        this.server.once('error', (err: NodeJS.ErrnoException) => fail(err));
        this.server.listen(0, '127.0.0.1', onListen);
      };

      this.server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tryFallback();
        } else {
          fail(err);
        }
      });
      this.server.listen(PREFERRED_PORT, '127.0.0.1', onListen);
    });
  }

  setFile(fsPath: string): string {
    return this.registerFile(fsPath);
  }

  // Callback fired when reload(fsPath) is called. extension.ts registers a
  // handler that broadcasts a postMessage to every webview panel for that file.
  // This replaces the WebSocket-based broadcast that was the root cause of the
  // window-reload hang.
  private _reloadListener: ((fsPath: string) => void) | undefined;
  onReloadRequested(fn: (fsPath: string) => void) { this._reloadListener = fn; }

  reload(fsPath: string) {
    try { this._reloadListener?.(fsPath); } catch (err) {
      console.log('[gossamer] reload listener threw:', err);
    }
  }

  dispose() {
    // Forcibly destroy ALL still-open server sockets (HTTP keep-alive sockets).
    // Without this, server.close() awaits each socket's natural close which can
    // hang for many seconds on window reload — the browser-side closed
    // connections don't always propagate the FIN quickly, and Node's HTTP
    // server holds open Keep-Alive sockets by default.
    try {
      // closeAllConnections is Node 18.2+ and atomically destroys every
      // connection regardless of state. This is the magic bullet.
      const anyServer = this.server as any;
      if (typeof anyServer.closeAllConnections === 'function') {
        anyServer.closeAllConnections();
      }
      if (typeof anyServer.closeIdleConnections === 'function') {
        anyServer.closeIdleConnections();
      }
    } catch {}

    // server.close() returns the port to the OS. Without unref(), the server
    // keeps the event loop alive even after close() — which would block the
    // extension host from terminating cleanly.
    try { (this.server as any).unref?.(); } catch {}
    this.server.close();
  }
}
