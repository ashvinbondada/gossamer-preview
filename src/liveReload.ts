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
  var ws = new WebSocket('ws://' + location.host + location.pathname);
  ws.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  ws.onclose = function() { setTimeout(function() { location.reload(); }, 1000); };
  __iframeMark('iframe WS connecting');
  if (ws && typeof ws.addEventListener === 'function') {
    ws.addEventListener('open', function() { __iframeMark('iframe WS open'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { __iframeMark('iframe DOMContentLoaded'); });
  } else {
    __iframeMark('iframe DOM already ready');
  }
  window.addEventListener('load', function() { __iframeMark('iframe window LOAD'); });

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
        res.writeHead(200, { 'Content-Type': 'text/html' });
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

  reload(fsPath: string) {
    const urlPath = this.registerFile(fsPath);
    const bucket = this.clients.get(urlPath);
    const clientCount = bucket?.size ?? 0;
    console.log(`[gossamer] reload() for ${urlPath}, ${clientCount} clients`);
    bucket?.forEach((ws) => { if (ws.readyState === 1) ws.send('reload'); });
    if (clientCount > 0) {
      capture('live reload triggered', { client_count: clientCount });
    }
  }

  dispose() {
    this.clients.forEach((bucket) => bucket.forEach((ws) => ws.terminate?.()));
    this.clients.clear();
    this.server.close();
  }
}
