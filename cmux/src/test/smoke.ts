// Minimal end-to-end smoke test for the preview server: registration, asset
// serving, live-reload-client injection, and an SSE reload on file change.
// Run with `npm run build && npm run smoke` (no test framework needed).

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PreviewServer } from '../server';

function get(port: number, p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gossamer-smoke-'));
  const htmlPath = path.join(dir, 'index.html');
  const cssPath = path.join(dir, 'style.css');
  fs.writeFileSync(htmlPath, '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>hello</h1></body></html>');
  fs.writeFileSync(cssPath, 'h1{color:red}');

  const server = new PreviewServer('test');
  const port = await server.start(0);
  console.log(`server on ${port}, dir ${dir}`);

  const urlPath = server.registerFile(htmlPath);
  assert(/^\/f\/\d+\/index\.html$/.test(urlPath), `urlPath is mounted (${urlPath})`);

  const htmlRes = await get(port, urlPath);
  assert(htmlRes.status === 200, 'html served 200');
  assert(htmlRes.body.includes('<h1>hello</h1>'), 'original html preserved');
  assert(htmlRes.body.includes('data-gossamer-livereload'), 'live-reload client injected');
  assert(htmlRes.body.includes('/__gossamer/events'), 'SSE endpoint referenced in client');

  const cssUrl = urlPath.replace(/index\.html$/, 'style.css');
  const cssRes = await get(port, cssUrl);
  assert(cssRes.status === 200, 'css served 200');
  assert((cssRes.headers['content-type'] || '').includes('text/css'), 'css content-type');
  assert(cssRes.body.includes('color:red'), 'css body served');

  // Path traversal must be blocked.
  const evil = await get(port, urlPath.replace(/index\.html$/, '..%2f..%2fetc%2fpasswd'));
  assert(evil.status === 403 || evil.status === 404, 'path traversal blocked');

  // Live reload over SSE.
  const reloaded = await new Promise<boolean>((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__gossamer/events?u=' + encodeURIComponent(urlPath) }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { if (chunk.includes('data: reload')) resolve(true); });
    });
    req.on('error', () => resolve(false));
    // Give the SSE handler a moment to register, then change the file.
    setTimeout(() => { fs.writeFileSync(htmlPath, '<!doctype html><body><h1>changed</h1></body>'); }, 300);
    setTimeout(() => resolve(false), 4000);
  });
  assert(reloaded, 'file change pushed an SSE reload');

  server.dispose();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log('\nSMOKE PASSED');
}

main().catch((err) => { console.error('\nSMOKE FAILED:', err.message); process.exit(1); });
