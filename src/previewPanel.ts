import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml } from './previewHtml';

export { buildHtml } from './previewHtml';

const panels = new Map<string, vscode.WebviewPanel>(); // fsPath -> panel

export function showPreview(fsPath: string, previewUrl: string) {
  const existing = panels.get(fsPath);
  if (existing) {
    existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Beside, true);
    return;
  }
  const title = path.basename(fsPath);
  const copyPath = vscode.workspace.asRelativePath(fsPath, false);
  const panel = vscode.window.createWebviewPanel(
    'gossamerPreview',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = buildHtml(previewUrl, title, copyPath);
  panel.onDidDispose(() => panels.delete(fsPath));
  panels.set(fsPath, panel);
}

export function disposeAllPreviews() {
  panels.forEach((p) => p.dispose());
  panels.clear();
}
