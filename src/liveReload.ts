import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';

const WS_RELOAD_SCRIPT = `
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host + location.pathname);
  ws.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  ws.onclose = function() { setTimeout(function() { location.reload(); }, 1000); };
})();
</script>
`;

function injectReloadScript(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', WS_RELOAD_SCRIPT + '</body>');
  }
  return html + WS_RELOAD_SCRIPT;
}

export class LiveReloadServer {
  private server: http.Server;
  private clients: Map<string, Set<any>> = new Map(); // urlPath -> clients
  private fileMap: Map<string, string> = new Map(); // urlPath -> fsPath
  public port = 0;

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
        const html = fs.readFileSync(fsPath, 'utf8');
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
