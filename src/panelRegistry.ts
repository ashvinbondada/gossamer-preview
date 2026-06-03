import * as vscode from 'vscode';

// Tracks all open webview panels keyed by fsPath. Both the customEditor and
// the manual `gossamer-preview.open` command path register here. extension.ts
// reads the registry to broadcast reload-requested signals via postMessage,
// replacing the old WebSocket-based broadcast that hung Cursor's webview
// disposal on window reload.

const panels = new Map<string, Set<vscode.WebviewPanel>>();

export function registerPanel(fsPath: string, panel: vscode.WebviewPanel): void {
  let bucket = panels.get(fsPath);
  if (!bucket) { bucket = new Set(); panels.set(fsPath, bucket); }
  bucket.add(panel);
  panel.onDidDispose(() => {
    bucket?.delete(panel);
    if (bucket && bucket.size === 0) panels.delete(fsPath);
  });
}

export function panelsFor(fsPath: string): vscode.WebviewPanel[] {
  return Array.from(panels.get(fsPath) ?? []);
}

export function allPanels(): vscode.WebviewPanel[] {
  const out: vscode.WebviewPanel[] = [];
  panels.forEach((bucket) => bucket.forEach((p) => out.push(p)));
  return out;
}

export function clearAll(): void { panels.clear(); }
