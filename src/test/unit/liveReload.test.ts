import * as assert from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

  // Behavioral coverage for the reload listener and find helper lives in
  // liveReload.dom.test.ts. These two tests only guard the placement contract
  // of injectReloadScript itself.
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
    assert.ok(r.body.includes('gossamer-reload'), 'live-reload script should be injected');
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

describe('LiveReloadServer reload', () => {
  let server: LiveReloadServer;

  beforeEach(async () => {
    server = new LiveReloadServer();
    await server.start();
  });
  afterEach(() => server.dispose());

  // Reload is delivered to in-editor webviews via the registered listener
  // (which extension.ts wires to webview.postMessage). There is no longer a
  // WebSocket transport.
  it('invokes the registered reload listener with the fs path', () => {
    const seen: string[] = [];
    server.onReloadRequested((p) => seen.push(p));
    server.reload('/tmp/some-file.html');
    assert.deepStrictEqual(seen, ['/tmp/some-file.html']);
  });

  it('reload() with no listener registered is a no-op (does not throw)', () => {
    assert.doesNotThrow(() => server.reload('/tmp/never-registered.html'));
  });
});

describe('LiveReloadServer.start hang safety', () => {
  it('start() resolves quickly under normal conditions', async function() {
    this.timeout(3500);
    const s = new LiveReloadServer();
    const t0 = Date.now();
    const port = await s.start();
    const dt = Date.now() - t0;
    assert.ok(port > 0);
    assert.ok(dt < 3000, `start() should finish well under the 3s timeout, took ${dt}ms`);
    s.dispose();
  });

  it('start() falls back to a random port when 7654 is in use', async function() {
    this.timeout(5000);
    // Hog port 7654 with a dummy listener.
    const hog = http.createServer();
    await new Promise<void>((resolve, reject) => {
      hog.once('error', (e: NodeJS.ErrnoException) => {
        // If 7654 was already taken by something else, skip this test gracefully.
        if (e.code === 'EADDRINUSE') resolve();
        else reject(e);
      });
      hog.listen(7654, '127.0.0.1', () => resolve());
    });

    const s = new LiveReloadServer();
    const port = await s.start();
    assert.ok(port > 0);
    assert.notStrictEqual(port, 7654, 'should have fallen back off the hogged port');

    s.dispose();
    await new Promise<void>((resolve) => hog.close(() => resolve()));
  });
});
