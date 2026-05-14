import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';

const WS_RELOAD_SCRIPT = `
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host);
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
          const frame = Buffer.alloc(2 + payload.length);
          frame[0] = 0x81;
          frame[1] = payload.length;
          payload.copy(frame, 2);
          socket.write(frame);
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
