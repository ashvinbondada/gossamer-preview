import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { capture, captureException } from './posthog';

// Internal dev-only flag. Hard-coded false for shipped builds. Flip locally to
// emit iframe-side perf marks (forwarded to parent overlay). Not user-toggleable.
const PERF_OVERLAY_ENABLED = false;

const PERF_HEADER = PERF_OVERLAY_ENABLED ? `
  function __iframeMark(name) {
    try {
      var t = (performance.now ? performance.now() : Date.now());
      parent.postMessage({ type: 'gossamer-perf', name: name, t: t }, '*');
    } catch (e) {}
  }
  __iframeMark('iframe script start');
` : `
  function __iframeMark() {}
`;

const INJECTED = `
<style>
:root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
</style>
<script>
(function() {
${PERF_HEADER}
  // Live reload via postMessage from parent webview — NOT WebSocket.
  // The old WebSocket-based reload was the root cause of window-reload hangs:
  // Cursor's webview disposal awaited the ws.close handshake, which could
  // take 30-60 seconds because the browser doesn't always propagate FIN
  // promptly when an iframe is being torn down. postMessage has no such
  // teardown semantics; it just stops being delivered.
  // ===== LOCALHOST FETCH BRIDGE =====
  // VS Code's webview service worker intercepts http://localhost:* fetches and
  // fails to resolve the webview ID for srcdoc iframes, producing "Failed to
  // fetch" regardless of CORS headers. We bypass it entirely: monkey-patch
  // window.fetch and XMLHttpRequest.open so that any localhost/127.0.0.1
  // request is routed via postMessage to the parent webview, which relays to
  // the extension host (Node.js), which makes the actual HTTP call and sends
  // back the response. Non-localhost URLs pass through to the native fetch.
  (function() {
    var _nativeFetch = window.fetch;
    var _pendingFetch = {};

    function isLocalhost(url) {
      try {
        var u = new URL(url, location.href);
        return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      } catch (e) { return false; }
    }

    function nextId() {
      return 'bf-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    }

    function bridgeFetch(url, init) {
      var id = nextId();
      return new Promise(function(resolve, reject) {
        _pendingFetch[id] = { resolve: resolve, reject: reject };

        var method = (init && init.method) ? init.method.toUpperCase() : 'GET';
        var headers = {};
        if (init && init.headers) {
          if (init.headers && typeof init.headers.forEach === 'function') {
            init.headers.forEach(function(v, k) { headers[k] = v; });
          } else {
            for (var k in init.headers) {
              if (Object.prototype.hasOwnProperty.call(init.headers, k)) headers[k] = init.headers[k];
            }
          }
        }

        var bodyStr = null;
        if (init && init.body != null) {
          if (typeof init.body === 'string') {
            bodyStr = init.body;
          } else if (init.body instanceof URLSearchParams) {
            bodyStr = init.body.toString();
            if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/x-www-form-urlencoded';
          } else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
            // Binary: base64-encode so it survives postMessage serialization
            var bytes = init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
            var bin = '';
            for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            bodyStr = btoa(bin);
            headers['x-gossamer-body-encoding'] = 'base64';
          } else {
            bodyStr = String(init.body);
          }
        }

        parent.postMessage({
          type: 'gossamer-bridge-fetch',
          id: id, url: url, method: method,
          headers: headers, body: bodyStr
        }, '*');
      });
    }

    window.addEventListener('message', function(e) {
      var msg = e.data;
      if (!msg || msg.type !== 'gossamer-bridge-fetch-result') return;
      var pending = _pendingFetch[msg.id];
      if (!pending) return;
      delete _pendingFetch[msg.id];

      if (msg.error) { pending.reject(new TypeError(msg.error)); return; }

      // Decode base64 body back to Uint8Array
      var bodyBytes;
      try {
        var bin2 = atob(msg.bodyB64 || '');
        bodyBytes = new Uint8Array(bin2.length);
        for (var j = 0; j < bin2.length; j++) bodyBytes[j] = bin2.charCodeAt(j);
      } catch (e2) { bodyBytes = new Uint8Array(0); }

      var hdrs = new Headers();
      if (msg.headers) {
        for (var hk in msg.headers) {
          if (Object.prototype.hasOwnProperty.call(msg.headers, hk)) {
            try { hdrs.append(hk, msg.headers[hk]); } catch (e3) {}
          }
        }
      }

      var resp = new Response(bodyBytes, {
        status: msg.status || 200,
        statusText: msg.statusText || 'OK',
        headers: hdrs,
      });
      pending.resolve(resp);
    });

    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      if (isLocalhost(url)) return bridgeFetch(url, init);
      return _nativeFetch.apply(this, arguments);
    };

    // XMLHttpRequest shim for localhost
    var _XHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._gossamerUrl = String(url);
      this._gossamerMethod = method;
      this._gossamerIsLocal = isLocalhost(this._gossamerUrl);
      if (!this._gossamerIsLocal) {
        return _XHROpen.apply(this, arguments);
      }
      // Stub out native open — we'll intercept send() instead
      this._gossamerHeaders = {};
      this._gossamerOpened = true;
    };
    var _XHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      if (this._gossamerOpened && this._gossamerIsLocal) {
        this._gossamerHeaders[name] = value;
        return;
      }
      return _XHRSetHeader.apply(this, arguments);
    };
    var _XHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (!this._gossamerOpened || !this._gossamerIsLocal) {
        return _XHRSend.apply(this, arguments);
      }
      var self = this;
      var bodyStr = body != null ? String(body) : null;
      bridgeFetch(this._gossamerUrl, {
        method: this._gossamerMethod || 'GET',
        headers: this._gossamerHeaders || {},
        body: bodyStr,
      }).then(function(resp) {
        resp.text().then(function(text) {
          Object.defineProperty(self, 'readyState', { get: function() { return 4; }, configurable: true });
          Object.defineProperty(self, 'status', { get: function() { return resp.status; }, configurable: true });
          Object.defineProperty(self, 'statusText', { get: function() { return resp.statusText; }, configurable: true });
          Object.defineProperty(self, 'responseText', { get: function() { return text; }, configurable: true });
          Object.defineProperty(self, 'response', { get: function() { return text; }, configurable: true });
          if (typeof self.onreadystatechange === 'function') try { self.onreadystatechange(); } catch (e) {}
          if (typeof self.onload === 'function') try { self.onload(); } catch (e) {}
          try { self.dispatchEvent(new Event('readystatechange')); } catch (e) {}
          try { self.dispatchEvent(new Event('load')); } catch (e) {}
        });
      }).catch(function(err) {
        if (typeof self.onerror === 'function') try { self.onerror(err); } catch (e) {}
        try { self.dispatchEvent(new Event('error')); } catch (e) {}
      });
    };
  })();
  // ===== END LOCALHOST FETCH BRIDGE =====

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'gossamer-reload') {
      try { parent.postMessage({ type: 'gossamer-iframe-log', msg: 'IFRAME got gossamer-reload, calling location.reload()' }, '*'); } catch (err) {}
      location.reload();
    }
  });
  __iframeMark('iframe reload listener attached');
  try { parent.postMessage({ type: 'gossamer-iframe-log', msg: 'IFRAME reload listener attached' }, '*'); } catch (err) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { __iframeMark('iframe DOMContentLoaded'); });
  } else {
    __iframeMark('iframe DOM already ready');
  }
  window.addEventListener('load', function() { __iframeMark('iframe window LOAD'); });

  // ===== SAME-PAGE ANCHOR FIX =====
  // We inject <base href="http://localhost:PORT/"> (see wrapWithBase in
  // previewHtml.ts) so relative asset URLs resolve correctly. But that base
  // also retargets fragment-only links: clicking <a href="#foo"> resolves to
  // http://localhost:PORT/#foo, which the browser treats as a full
  // cross-document navigation (not an in-page scroll), because the document's
  // actual URL is about:srcdoc while its base URL is the http: origin. That
  // navigation hits the live-reload server's root path, which was never
  // registered, producing "No file loaded for this path" and replacing the
  // whole document (which also kills this script, breaking copy). Intercept
  // fragment-only anchor clicks here and scroll manually instead.
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;
    var raw = el.getAttribute('href') || '';
    if (raw.charAt(0) !== '#' || raw.length < 2) return;
    e.preventDefault();
    var id = decodeURIComponent(raw.slice(1));
    var target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (history && history.replaceState) {
        try { history.replaceState(null, '', raw); } catch (err) {}
      }
    }
  }, false);
  // ===== END SAME-PAGE ANCHOR FIX =====

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
      try { parent.postMessage({ type: 'gossamer-iframe-log', msg: 'IFRAME Cmd+' + key.toUpperCase() + ' selection.len=' + text.length + ' preview=' + JSON.stringify(text.slice(0, 40)) }, '*'); } catch (err) {}
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
  private clients: Map<string, Set<any>> = new Map(); // urlPath -> clients
  private fileMap: Map<string, string> = new Map(); // urlPath -> fsPath
  private bufferText: Map<string, string> = new Map(); // fsPath -> in-memory editor text
  public port = 0;

  // Returns the live HTML content for an fs path: in-memory editor buffer if
  // the user has unsaved edits, otherwise reads from disk. Returns the RAW
  // file content (no live-reload script injection — that's only for the
  // legacy HTTP server path used by external browsers). Used by the
  // srcdoc-based iframe to assign content directly without going through HTTP.
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

    this.setupWebSocket();
  }

  private setupWebSocket() {
    this.server.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }

      const urlPath = req.url?.split('?')[0] ?? '/';
      const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
      );

      const ws = {
        readyState: 1,
        send: (msg: string) => {
          const payload = Buffer.from(msg);
          const len = payload.length;
          let header: Buffer;
          if (len < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x81; header[1] = len;
          } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81; header[1] = 126;
            header.writeUInt16BE(len, 2);
          } else {
            header = Buffer.alloc(10);
            header[0] = 0x81; header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
          }
          socket.write(Buffer.concat([header, payload]));
        },
        terminate: () => socket.destroy(),
      };

      if (!this.clients.has(urlPath)) this.clients.set(urlPath, new Set());
      this.clients.get(urlPath)!.add(ws);
      socket.on('close', () => this.clients.get(urlPath)?.delete(ws));
      socket.on('error', () => this.clients.get(urlPath)?.delete(ws));
    });
  }

  start(): Promise<number> {
    const PREFERRED_PORT = 7654;
    const STARTUP_TIMEOUT_MS = 3000;
    const t0 = Date.now();
    const dbg = (msg: string) => { try { console.log('[gossamer] server +' + (Date.now() - t0) + 'ms ' + msg); } catch {} };
    dbg('start() invoked');
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (port: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        dbg('resolved port=' + port);
        resolve(port);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        dbg('rejected ' + err.message);
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
        dbg('preferred port in use, falling back to random');
        this.server.removeAllListeners('error');
        this.server.once('error', (err: NodeJS.ErrnoException) => fail(err));
        this.server.listen(0, '127.0.0.1', onListen);
      };

      this.server.once('error', (err: NodeJS.ErrnoException) => {
        dbg('listen error code=' + err.code);
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
    // Still also push to legacy WebSocket clients for backwards compat with
    // external browsers (people opening http://localhost:7654/foo.html
    // directly in Chrome). These are not webviews and not the hang trigger.
    const urlPath = this.registerFile(fsPath);
    const bucket = this.clients.get(urlPath);
    const clientCount = bucket?.size ?? 0;
    bucket?.forEach((ws) => { if (ws.readyState === 1) ws.send('reload'); });
    if (clientCount > 0) {
      capture('live reload triggered', { client_count: clientCount });
    }
  }

  dispose() {
    const t0 = Date.now();
    const dbg = (msg: string) => {
      try { console.log('[gossamer] dispose +' + (Date.now() - t0) + 'ms ' + msg); } catch {}
      // Also write to the disk lifecycle log so we can see it post-mortem.
      try {
        // Use require to avoid a circular import at module load time.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { perfMark } = require('./perf');
        perfMark('  liveReload.dispose +' + (Date.now() - t0) + 'ms ' + msg);
      } catch {}
    };
    dbg('start');
    // Forcibly terminate every WebSocket wrapper we know about.
    let wsCount = 0;
    this.clients.forEach((bucket) => bucket.forEach((ws) => {
      wsCount++;
      try { ws.terminate?.(); } catch {}
    }));
    this.clients.clear();
    dbg('terminated ' + wsCount + ' ws wrappers');

    // Forcibly destroy ALL still-open server sockets (HTTP keep-alive, WebSocket
    // upgrades, etc.). Without this, server.close() awaits each socket's
    // natural close which can hang for many seconds on window reload — the
    // browser-side closed connections don't always propagate the FIN quickly,
    // and Node's HTTP server holds open Keep-Alive sockets by default.
    try {
      // closeAllConnections is Node 18.2+ and atomically destroys every
      // connection regardless of state. This is the magic bullet.
      const anyServer = this.server as any;
      if (typeof anyServer.closeAllConnections === 'function') {
        anyServer.closeAllConnections();
        dbg('closeAllConnections() called');
      }
      if (typeof anyServer.closeIdleConnections === 'function') {
        anyServer.closeIdleConnections();
        dbg('closeIdleConnections() called');
      }
    } catch (err: any) {
      dbg('connection close error: ' + (err && err.message ? err.message : err));
    }

    // server.close() returns the port to the OS. Without unref(), the server
    // keeps the event loop alive even after close() — which would block the
    // extension host from terminating cleanly.
    try { (this.server as any).unref?.(); } catch {}
    this.server.close((err) => {
      dbg('server.close cb ' + (err ? 'err=' + err.message : 'ok'));
    });
    dbg('dispose returned (server.close is async)');
  }
}
