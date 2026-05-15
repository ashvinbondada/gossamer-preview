import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';

const WS_RELOAD_SCRIPT = `
<script>
(function() {
  console.log('[gossamer] connecting to', 'ws://' + location.host);
  var ws = new WebSocket('ws://' + location.host);
  ws.onopen = function() { console.log('[gossamer] websocket connected'); };
  ws.onmessage = function(e) { console.log('[gossamer] message:', e.data); if (e.data === 'reload') location.reload(); };
  ws.onerror = function(e) { console.error('[gossamer] websocket error', e); };
  ws.onclose = function(e) { console.log('[gossamer] websocket closed', e.code, e.reason); setTimeout(function() { location.reload(); }, 1000); };
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
  private clients: Set<any> = new Set();
  private currentFilePath = '';
  public port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      if (!this.currentFilePath) {
        res.writeHead(404);
        res.end('No file loaded');
        return;
      }
      try {
        const html = fs.readFileSync(this.currentFilePath, 'utf8');
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
      if (!key) {
        socket.destroy();
        return;
      }
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
            header[0] = 0x81;
            header[1] = len;
          } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
          } else {
            header = Buffer.alloc(10);
            header[0] = 0x81;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
          }
          socket.write(Buffer.concat([header, payload]));
        },
        terminate: () => socket.destroy(),
      };

      this.clients.add(ws);
      socket.on('close', () => this.clients.delete(ws));
      socket.on('error', () => this.clients.delete(ws));
    });
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  setFile(filePath: string) {
    this.currentFilePath = filePath;
  }

  reload() {
    console.log(`[gossamer] reload() called, ${this.clients.size} clients connected`);
    this.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send('reload');
      }
    });
  }

  dispose() {
    this.clients.forEach((ws) => ws.terminate?.());
    this.clients.clear();
    this.server.close();
  }
}
