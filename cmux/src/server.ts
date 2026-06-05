import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { injectReloadClient } from './inject';

export const DEFAULT_PORT = 7654;
const HEARTBEAT_MS = 25000;
const WATCH_DEBOUNCE_MS = 120;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

function contentTypeFor(p: string): string {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function isHtml(p: string): boolean {
  const e = path.extname(p).toLowerCase();
  return e === '.html' || e === '.htm';
}

interface SseClient {
  res: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
}

/**
 * The gossamer-cmux preview server.
 *
 * Each registered HTML file's *containing directory* is mounted under
 * `/f/<id>/`, and the file itself is served at `/f/<id>/<basename>`. Mounting
 * the directory (not just the single file) is what lets relative assets —
 * `<link href="style.css">`, `<script src="assets/app.js">` — resolve against a
 * real HTTP origin, which the VS Code extension sidesteps with srcdoc + a
 * `<base href>` tag but a real browser (cmux's embedded Chromium) needs served
 * for real.
 *
 * Live reload is delivered over Server-Sent Events (`/__gossamer/events`): the
 * injected client (see inject.ts) opens an EventSource; a filesystem watcher on
 * each mounted directory pushes "reload" when anything in it changes.
 */
export class PreviewServer {
  readonly version: string;
  port = 0;

  private server: http.Server;

  // Directory mounts. A mount id is a small integer; the URL prefix is /f/<id>/.
  private mountSeq = 0;
  private mountIdByDir = new Map<string, number>();
  private dirByMountId = new Map<number, string>();
  private watchers = new Map<number, fs.FSWatcher>();
  private debounce = new Map<number, NodeJS.Timeout>();

  // Registered HTML files. Keys are the (encoded) URL paths the browser will
  // request, e.g. "/f/3/index.html"; values are absolute fs paths.
  private fileByUrl = new Map<string, string>();
  private urlByFile = new Map<string, string>();

  // Connected live-reload clients, keyed by the URL path they preview.
  private clientsByUrl = new Map<string, Set<SseClient>>();

  constructor(version: string) {
    this.version = version;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  // ---- registration -------------------------------------------------------

  /** Register an absolute fs path, returning the URL path it is served at. */
  registerFile(fsPath: string): string {
    const abs = path.resolve(fsPath);
    const existing = this.urlByFile.get(abs);
    if (existing) return existing;

    const dir = path.dirname(abs);
    const base = path.basename(abs);
    let id = this.mountIdByDir.get(dir);
    if (id === undefined) {
      id = ++this.mountSeq;
      this.mountIdByDir.set(dir, id);
      this.dirByMountId.set(id, dir);
      this.watchDir(id, dir);
    }
    const urlPath = `/f/${id}/${encodeURIComponent(base)}`;
    this.fileByUrl.set(urlPath, abs);
    this.urlByFile.set(abs, urlPath);
    return urlPath;
  }

  urlFor(fsPath: string): string | undefined {
    return this.urlByFile.get(path.resolve(fsPath));
  }

  registeredFiles(): string[] {
    return [...this.urlByFile.keys()];
  }

  // ---- filesystem watching ------------------------------------------------

  private watchDir(id: number, dir: string) {
    const onChange = (_event: string, filename: string | Buffer | null) => {
      this.onDirChange(id, dir, filename ? filename.toString() : null);
    };
    try {
      // Recursive watch (macOS/Windows native; Linux on newer Node) so assets in
      // subdirectories trigger reloads too.
      const w = fs.watch(dir, { recursive: true }, onChange);
      w.on('error', () => {});
      this.watchers.set(id, w);
    } catch {
      // Fall back to a non-recursive watch — still covers files sitting directly
      // in the mounted directory, which is the common single-file case.
      try {
        const w = fs.watch(dir, onChange);
        w.on('error', () => {});
        this.watchers.set(id, w);
      } catch { /* watching unavailable; reloads must be triggered manually */ }
    }
  }

  private onDirChange(id: number, dir: string, filename: string | null) {
    const prev = this.debounce.get(id);
    if (prev) clearTimeout(prev);
    this.debounce.set(id, setTimeout(() => {
      this.debounce.delete(id);
      // If we can pin the change to a single registered HTML file, reload only
      // that page. Otherwise (an asset, or an unnamed event) reload every page
      // served from this mount so shared CSS/JS edits propagate.
      if (filename) {
        const changedAbs = path.resolve(dir, filename);
        const url = this.urlByFile.get(changedAbs);
        if (url) {
          // The changed file is itself a registered HTML page → reload just it.
          this.reloadUrl(url);
          return;
        }
      }
      this.reloadMount(id);
    }, WATCH_DEBOUNCE_MS));
  }

  /** Force a reload of every page served from a given mount. */
  private reloadMount(id: number) {
    const prefix = `/f/${id}/`;
    for (const url of this.clientsByUrl.keys()) {
      if (url.startsWith(prefix)) this.reloadUrl(url);
    }
  }

  private reloadUrl(urlPath: string) {
    const set = this.clientsByUrl.get(urlPath);
    if (!set || set.size === 0) return;
    for (const c of set) {
      try { c.res.write('data: reload\n\n'); } catch { /* dropped on next close */ }
    }
  }

  /** Public: trigger a reload of a file by fs path (used as a manual fallback). */
  reload(fsPath: string) {
    const url = this.urlByFile.get(path.resolve(fsPath));
    if (url) this.reloadUrl(url);
  }

  // ---- request handling ---------------------------------------------------

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const pathname = u.pathname;

    if (pathname === '/__gossamer/ping') return this.sendJson(res, 200, this.pingPayload());
    if (pathname === '/__gossamer/register') return this.handleRegister(u, res);
    if (pathname === '/__gossamer/events') return this.handleEvents(u, req, res);
    if (pathname === '/__gossamer/shutdown') {
      this.sendJson(res, 200, { ok: true });
      setTimeout(() => { this.dispose(); process.exit(0); }, 50);
      return;
    }
    if (pathname === '/' || pathname === '') return this.sendIndex(res);
    if (pathname.startsWith('/f/')) return this.serveMounted(pathname, res);

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  private pingPayload() {
    return { gossamer: true, version: this.version, port: this.port, files: this.registeredFiles() };
  }

  private handleRegister(u: URL, res: http.ServerResponse) {
    const p = u.searchParams.get('path');
    if (!p) return this.sendJson(res, 400, { error: 'missing path' });
    const abs = path.resolve(p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return this.sendJson(res, 404, { error: 'file not found', path: abs });
    }
    const urlPath = this.registerFile(abs);
    this.sendJson(res, 200, { urlPath, url: `http://127.0.0.1:${this.port}${urlPath}`, path: abs });
  }

  private handleEvents(u: URL, req: http.IncomingMessage, res: http.ServerResponse) {
    const urlPath = u.searchParams.get('u');
    if (!urlPath) { res.writeHead(400).end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const heartbeat = setInterval(() => {
      try { res.write(': hb\n\n'); } catch { /* will be cleaned up on close */ }
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const client: SseClient = { res, heartbeat };
    let set = this.clientsByUrl.get(urlPath);
    if (!set) { set = new Set(); this.clientsByUrl.set(urlPath, set); }
    set.add(client);

    const cleanup = () => {
      clearInterval(heartbeat);
      const s = this.clientsByUrl.get(urlPath);
      if (s) { s.delete(client); if (s.size === 0) this.clientsByUrl.delete(urlPath); }
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  }

  private serveMounted(pathname: string, res: http.ServerResponse) {
    // /f/<id>/<rest...>
    const m = /^\/f\/(\d+)\/(.*)$/.exec(pathname);
    if (!m) { res.writeHead(404).end('Not found'); return; }
    const id = parseInt(m[1], 10);
    const dir = this.dirByMountId.get(id);
    if (!dir) { res.writeHead(404).end('Unknown mount'); return; }

    let rel: string;
    try { rel = decodeURIComponent(m[2]); } catch { res.writeHead(400).end('Bad path'); return; }

    let target = path.resolve(dir, rel);
    // Path-traversal guard: the resolved target must stay inside the mount.
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let stat: fs.Stats;
    try { stat = fs.statSync(target); } catch { res.writeHead(404).end('Not found'); return; }
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
      try { stat = fs.statSync(target); } catch { res.writeHead(404).end('Not found'); return; }
    }

    let buf: Buffer;
    try { buf = fs.readFileSync(target); } catch { res.writeHead(500).end('Read error'); return; }

    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': contentTypeFor(target),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };

    if (isHtml(target)) {
      // Inject the live-reload client. The SSE channel id is the request path
      // itself, which is exactly the key clientsByUrl is registered under.
      const html = injectReloadClient(buf.toString('utf8'), pathname);
      res.writeHead(200, headers);
      res.end(html);
    } else {
      res.writeHead(200, headers);
      res.end(buf);
    }
  }

  private sendIndex(res: http.ServerResponse) {
    const items = [...this.fileByUrl.entries()]
      .map(([url, file]) => `<li><a href="${url}">${path.basename(file)}</a> <span style="color:#888">${file}</span></li>`)
      .join('\n');
    const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gossamer Preview (cmux)</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;background:#0d0d0f;color:#e6e6e6;padding:32px}a{color:#7c9eff}li{margin:6px 0}</style>
</head><body><h1>Gossamer Preview</h1><p>gossamer-cmux v${this.version} · port ${this.port}</p>
${items ? `<ul>${items}</ul>` : '<p style="color:#888">No files registered yet. Run <code>gossamer open &lt;file.html&gt;</code>.</p>'}
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  private sendJson(res: http.ServerResponse, code: number, payload: unknown) {
    const body = JSON.stringify(payload);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  // ---- lifecycle ----------------------------------------------------------

  start(port = DEFAULT_PORT): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => { reject(err); };
      this.server.once('error', onError);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', onError);
        const addr = this.server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : port;
        resolve(this.port);
      });
    });
  }

  dispose() {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    for (const w of this.watchers.values()) { try { w.close(); } catch {} }
    this.watchers.clear();
    for (const set of this.clientsByUrl.values()) {
      for (const c of set) { clearInterval(c.heartbeat); try { c.res.end(); } catch {} }
    }
    this.clientsByUrl.clear();
    try { (this.server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch {}
    try { this.server.close(); } catch {}
  }
}
