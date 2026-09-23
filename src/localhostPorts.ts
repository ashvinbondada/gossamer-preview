import * as vscode from 'vscode';
import { DEFAULT_LOCALHOST_PORTS } from './localhostPortsDefaults';

export { DEFAULT_LOCALHOST_PORTS };

// Read user-supplied additions from the `gossamer-preview.allowedLocalhostPorts`
// setting. Quietly drops anything that isn't a valid port number — we don't
// want a malformed setting to wedge the editor. Deduplicates against the defaults.
export function resolveLocalhostPorts(): number[] {
  const cfg = vscode.workspace.getConfiguration('gossamer-preview');
  const raw = cfg.get<unknown>('allowedLocalhostPorts', []);
  const extras: number[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      const n = typeof p === 'number' ? p : Number(p);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) extras.push(n);
    }
  }
  const merged = new Set<number>(DEFAULT_LOCALHOST_PORTS);
  for (const p of extras) merged.add(p);
  return Array.from(merged).sort((a, b) => a - b);
}

export function localhostPortMapping(): vscode.WebviewPortMapping[] {
  return resolveLocalhostPorts().map((p) => ({ webviewPort: p, extensionHostPort: p }));
}
