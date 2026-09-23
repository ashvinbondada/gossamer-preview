import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

// Per-panel map of requestId -> AbortController for in-flight bridge requests.
// Keyed by panel identity (panel itself as key). Cleaned up on panel dispose.
const panelRequests = new WeakMap<vscode.WebviewPanel, Map<string, AbortController>>();

function getOrCreateMap(panel: vscode.WebviewPanel): Map<string, AbortController> {
  let m = panelRequests.get(panel);
  if (!m) { m = new Map(); panelRequests.set(panel, m); }
  return m;
}

// Hard timeout for any single bridge fetch. 30s matches browser's default.
const BRIDGE_TIMEOUT_MS = 30_000;

export function handleBridgeMessage(
  panel: vscode.WebviewPanel,
  msg: any
): boolean {
  if (!msg || msg.type !== 'gossamer-bridge-fetch') return false;

  const { id, url, method, headers, body } = msg;
  if (typeof id !== 'string' || typeof url !== 'string') return false;

  const ac = new AbortController();
  const reqMap = getOrCreateMap(panel);
  reqMap.set(id, ac);

  const timeoutHandle = setTimeout(() => ac.abort(), BRIDGE_TIMEOUT_MS);

  _doFetch(url, method || 'GET', headers || {}, body ?? null, ac.signal)
    .then((result) => {
      panel.webview.postMessage({ type: 'gossamer-bridge-fetch-result', id, ...result });
    })
    .catch((err: any) => {
      const msg2 = err && err.name === 'AbortError' ? 'Request aborted' : String(err?.message || err);
      panel.webview.postMessage({ type: 'gossamer-bridge-fetch-result', id, error: msg2 });
    })
    .finally(() => {
      clearTimeout(timeoutHandle);
      reqMap.delete(id);
    });

  return true;
}

// Abort all in-flight requests for a panel. Called synchronously on dispose.
export function abortPanelRequests(panel: vscode.WebviewPanel): void {
  const m = panelRequests.get(panel);
  if (!m) return;
  for (const ac of m.values()) {
    try { ac.abort(); } catch {}
  }
  m.clear();
}

interface FetchResult {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyB64?: string;
  error?: string;
}

function _doFetch(
  url: string,
  method: string,
  reqHeaders: Record<string, string>,
  body: string | null,
  signal: AbortSignal
): Promise<FetchResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: FetchResult) => { if (!settled) { settled = true; resolve(r); } };

    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch {
      done({ error: 'Invalid URL: ' + url }); return;
    }

    // Only proxy localhost/127.0.0.1. Refuse anything else.
    const host = parsedUrl.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      done({ error: 'gossamer-bridge only proxies localhost URLs' }); return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : (isHttps ? 443 : 80);
    const path = parsedUrl.pathname + parsedUrl.search;

    const mergedHeaders: Record<string, string> = { ...reqHeaders };
    if (body && !mergedHeaders['content-length'] && !mergedHeaders['Content-Length']) {
      const buf = Buffer.from(body, 'utf8');
      mergedHeaders['content-length'] = String(buf.length);
    }

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: method.toUpperCase(),
      headers: mergedHeaders,
    };

    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const outHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') outHeaders[k] = v;
          else if (Array.isArray(v)) outHeaders[k] = v[0];
        }
        done({
          status: res.statusCode ?? 200,
          statusText: res.statusMessage ?? 'OK',
          headers: outHeaders,
          bodyB64: buf.toString('base64'),
        });
      });
      res.on('error', (err: Error) => done({ error: err.message }));
    });

    req.on('error', (err: Error) => done({ error: err.message }));

    signal.addEventListener('abort', () => {
      try { req.destroy(); } catch {}
      done({ error: 'Request aborted' });
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
