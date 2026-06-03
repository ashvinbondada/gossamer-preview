import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml } from './previewHtml';
import { perfScope } from './perf';

export { buildHtml } from './previewHtml';

const panels = new Map<string, vscode.WebviewPanel>(); // fsPath -> panel

export function showPreview(fsPath: string, previewUrl: string) {
  const t = perfScope('showPreview', fsPath);
  const existing = panels.get(fsPath);
  if (existing) {
    t.mark('reuse existing panel');
    existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Beside, true);
    t.mark('reveal called');
    t.end();
    return;
  }
  const title = path.basename(fsPath);
  const copyPath = vscode.workspace.asRelativePath(fsPath, false);
  t.mark('paths computed');
  const panel = vscode.window.createWebviewPanel(
    'gossamerPreview',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  t.mark('createWebviewPanel returned');
  const html = buildHtml(previewUrl, title, copyPath);
  t.mark(`buildHtml done (${html.length} chars)`);
  panel.webview.html = html;
  t.mark('webview.html assigned');
  panel.onDidDispose(() => panels.delete(fsPath));
  panels.set(fsPath, panel);
  t.end();
}

export function disposeAllPreviews() {
  panels.forEach((p) => p.dispose());
  panels.clear();
}
