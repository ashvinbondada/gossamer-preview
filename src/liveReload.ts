import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';

const INJECTED = `
<style>
:root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
</style>
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host + location.pathname);
  ws.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  ws.onclose = function() { setTimeout(function() { location.reload(); }, 1000); };

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

  document.addEventListener('keydown', function(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'f' || e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
      parent.postMessage({ type: 'gossamer-key', key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, '*');
    } else if (e.key === 'Escape') {
      parent.postMessage({ type: 'gossamer-key', key: 'Escape' }, '*');
    }
  }, true);
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
      } catch {
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
    return new Promise((resolve) => {
      const tryListen = (port: number) => {
        this.server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            // Port taken (another Cursor window) — fall back to random
            this.server.listen(0, '127.0.0.1', () => {
              const addr = this.server.address() as { port: number };
              this.port = addr.port;
              resolve(this.port);
            });
          }
        });
        this.server.listen(port, '127.0.0.1', () => {
          const addr = this.server.address() as { port: number };
          this.port = addr.port;
          resolve(this.port);
        });
      };
      tryListen(PREFERRED_PORT);
    });
  }

  setFile(fsPath: string): string {
    return this.registerFile(fsPath);
  }

  reload(fsPath: string) {
    const urlPath = this.registerFile(fsPath);
    const bucket = this.clients.get(urlPath);
    console.log(`[gossamer] reload() for ${urlPath}, ${bucket?.size ?? 0} clients`);
    bucket?.forEach((ws) => { if (ws.readyState === 1) ws.send('reload'); });
  }

  dispose() {
    this.clients.forEach((bucket) => bucket.forEach((ws) => ws.terminate?.()));
    this.clients.clear();
    this.server.close();
  }
}
