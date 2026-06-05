import * as http from 'http';

export interface PingResult {
  gossamer: boolean;
  version: string;
  port: number;
  files: string[];
}

export interface RegisterResult {
  urlPath: string;
  url: string;
  path: string;
}

function getJson<T>(port: number, path: string, timeoutMs = 2000): Promise<T | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/** Returns the running daemon's ping payload, or null if nothing answers. */
export function ping(port: number): Promise<PingResult | null> {
  return getJson<PingResult>(port, '/__gossamer/ping');
}

/** Ask the daemon to register a file; returns its served URL. */
export function register(port: number, absPath: string): Promise<RegisterResult | null> {
  return getJson<RegisterResult>(port, '/__gossamer/register?path=' + encodeURIComponent(absPath));
}

/** Ask the daemon to shut down. */
export function shutdown(port: number): Promise<boolean> {
  return getJson<{ ok: boolean }>(port, '/__gossamer/shutdown').then((r) => !!r?.ok);
}
