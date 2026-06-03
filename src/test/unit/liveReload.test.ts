import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { LiveReloadServer, injectReloadScript } from '../../liveReload';

function tmpHtml(content: string): string {
  const p = path.join(os.tmpdir(), `gossamer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(p, content);
  return p;
}

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

// Minimal WS client: sends a handshake, then parses frames.
function wsConnect(port: number, urlPath: string): Promise<{ socket: net.Socket; nextMessage: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${urlPath} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buffer = Buffer.alloc(0);
    let handshakeDone = false;
    const pendingResolvers: ((m: string) => void)[] = [];
    const messageQueue: string[] = [];

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const sep = buffer.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const headers = buffer.slice(0, sep).toString();
        if (!/101/.test(headers)) { reject(new Error('Handshake failed: ' + headers)); return; }
        buffer = buffer.slice(sep + 4);
        handshakeDone = true;
        resolve({
          socket,
          nextMessage: () => new Promise((res) => {
            if (messageQueue.length) res(messageQueue.shift()!);
            else pendingResolvers.push(res);
          })
        });
      }
      while (handshakeDone && buffer.length >= 2) {
        const b1 = buffer[0];
        const b2 = buffer[1];
        const opcode = b1 & 0x0f;
        let len = b2 & 0x7f;
        let offset = 2;
        if (len === 126) { len = buffer.readUInt16BE(2); offset = 4; }
        else if (len === 127) { len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
        if (buffer.length < offset + len) break;
        const payload = buffer.slice(offset, offset + len).toString();
        buffer = buffer.slice(offset + len);
        if (opcode === 0x1) {
          if (pendingResolvers.length) pendingResolvers.shift()!(payload);
          else messageQueue.push(payload);
        }
      }
    });
    socket.on('error', reject);
  });
}

describe('injectReloadScript', () => {
  it('inserts before </body>', () => {
    const out = injectReloadScript('<html><body>hi</body></html>');
    assert.ok(out.includes('<script>'));
    assert.ok(out.indexOf('<script>') < out.indexOf('</body>'));
  });

  it('appends if no body tag', () => {
    const out = injectReloadScript('<p>hi</p>');
    assert.ok(out.startsWith('<p>hi</p>'));
    assert.ok(out.includes('<script>'));
  });

  it('includes ws connect to location.pathname', () => {
    const out = injectReloadScript('<body></body>');
    assert.ok(out.includes("ws://"));
    assert.ok(out.includes('location.pathname'));
  });

  it('reloads on receiving "reload" message', () => {
    const out = injectReloadScript('<body></body>');
    assert.ok(out.includes("e.data === 'reload'"));
    assert.ok(out.includes('location.reload()'));
  });

  it('reconnects on close', () => {
    const out = injectReloadScript('<body></body>');
    assert.ok(out.includes('ws.onclose'));
  });

  it('injects find helper that walks text nodes and skips script/style', () => {
    const out = injectReloadScript('<body></body>');
    assert.ok(out.includes('SHOW_TEXT'));
    assert.ok(out.includes("'SCRIPT'"));
    assert.ok(out.includes("'STYLE'"));
    assert.ok(out.includes("'gossamer-find'"));
  });

  it('forwards Cmd/Ctrl+F keydown to parent', () => {
    const out = injectReloadScript('<body></body>');
    assert.ok(out.includes("'gossamer-key'"));
    assert.ok(out.includes('metaKey'));
    assert.ok(out.includes("'f'"));
  });
});

describe('LiveReloadServer HTTP', () => {
  let server: LiveReloadServer;

  beforeEach(async () => {
    server = new LiveReloadServer();
    await server.start();
  });
  afterEach(() => server.dispose());

  it('starts on 7654 or fallback', () => {
    assert.ok(server.port > 0);
  });

  it('returns 404 for unregistered path', async () => {
    const r = await get(server.port, '/nope.html');
    assert.strictEqual(r.status, 404);
  });

  it('serves disk content and injects script', async () => {
    const file = tmpHtml('<html><body><h1>hello</h1></body></html>');
    const urlPath = server.setFile(file);
    const r = await get(server.port, urlPath);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<h1>hello</h1>'));
    assert.ok(r.body.includes('WebSocket'));
    fs.unlinkSync(file);
  });

  it('returns the same urlPath when re-registering the same file', () => {
    const file = tmpHtml('<body></body>');
    const a = server.setFile(file);
    const b = server.setFile(file);
    assert.strictEqual(a, b);
    fs.unlinkSync(file);
  });

  it('encodes special characters in filename', () => {
    const file = tmpHtml('<body></body>');
    const renamed = file.replace(/\.html$/, ' with spaces.html');
    fs.renameSync(file, renamed);
    const urlPath = server.setFile(renamed);
    assert.ok(urlPath.includes('%20') || urlPath.includes('+'), `expected encoded path, got ${urlPath}`);
    fs.unlinkSync(renamed);
  });

  it('serves buffer text over disk when set', async () => {
    const file = tmpHtml('<body>DISK</body>');
    const urlPath = server.setFile(file);
    server.setBufferText(file, '<body>BUFFER</body>');
    const r = await get(server.port, urlPath);
    assert.ok(r.body.includes('BUFFER'));
    assert.ok(!r.body.includes('DISK'));
    fs.unlinkSync(file);
  });

  it('falls back to disk after clearBufferText', async () => {
    const file = tmpHtml('<body>DISK</body>');
    const urlPath = server.setFile(file);
    server.setBufferText(file, '<body>BUFFER</body>');
    server.clearBufferText(file);
    const r = await get(server.port, urlPath);
    assert.ok(r.body.includes('DISK'));
    fs.unlinkSync(file);
  });

  it('returns 500 when disk file is missing and no buffer', async () => {
    const file = tmpHtml('<body></body>');
    const urlPath = server.setFile(file);
    fs.unlinkSync(file);
    const r = await get(server.port, urlPath);
    assert.strictEqual(r.status, 500);
  });

  it('serves multiple distinct files at distinct paths', async () => {
    const f1 = tmpHtml('<body>ONE</body>');
    const f2 = tmpHtml('<body>TWO</body>');
    const p1 = server.setFile(f1);
    const p2 = server.setFile(f2);
    assert.notStrictEqual(p1, p2);
    const r1 = await get(server.port, p1);
    const r2 = await get(server.port, p2);
    assert.ok(r1.body.includes('ONE'));
    assert.ok(r2.body.includes('TWO'));
    fs.unlinkSync(f1); fs.unlinkSync(f2);
  });
});

describe('LiveReloadServer WebSocket', () => {
  let server: LiveReloadServer;

  beforeEach(async () => {
    server = new LiveReloadServer();
    await server.start();
  });
  afterEach(() => server.dispose());

  it('accepts WS upgrade and receives reload message', async function() {
    this.timeout(5000);
    const file = tmpHtml('<body></body>');
    const urlPath = server.setFile(file);
    const { socket, nextMessage } = await wsConnect(server.port, urlPath);
    // give the server a tick to register the client
    await new Promise((r) => setTimeout(r, 30));
    server.reload(file);
    const msg = await nextMessage();
    assert.strictEqual(msg, 'reload');
    socket.destroy();
    fs.unlinkSync(file);
  });

  it('only notifies clients for the matching file path', async function() {
    this.timeout(5000);
    const f1 = tmpHtml('<body>1</body>');
    const f2 = tmpHtml('<body>2</body>');
    const p1 = server.setFile(f1);
    const p2 = server.setFile(f2);
    const c1 = await wsConnect(server.port, p1);
    const c2 = await wsConnect(server.port, p2);
    await new Promise((r) => setTimeout(r, 30));

    let got2 = false;
    c2.nextMessage().then(() => { got2 = true; });

    server.reload(f1);
    const m1 = await c1.nextMessage();
    assert.strictEqual(m1, 'reload');
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(got2, false, 'file2 client should not have received');

    c1.socket.destroy(); c2.socket.destroy();
    fs.unlinkSync(f1); fs.unlinkSync(f2);
  });

  it('reload() on unregistered path is a no-op (does not throw)', () => {
    assert.doesNotThrow(() => server.reload('/tmp/never-registered.html'));
  });
});
