import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml, wrapWithBase } from './previewHtml';
import { perfScope } from './perf';
import { dispatchHostKey } from './hostKeys';
import { capture, captureException } from './posthog';
import { registerPanel } from './panelRegistry';

export { buildHtml } from './previewHtml';

const panels = new Map<string, vscode.WebviewPanel>(); // fsPath -> panel

export function showPreview(fsPath: string, previewUrl: string, getRawHtml?: (fsPath: string) => string) {
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
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'host-key') {
      try {
        const ran = await dispatchHostKey(msg);
        if (ran) capture('host_key_dispatched', { command: ran });
      } catch (err) {
        captureException(err, { context: 'host_key_dispatch' });
      }
    }
  });
  panel.onDidDispose(() => panels.delete(fsPath));
  panels.set(fsPath, panel);
  registerPanel(fsPath, panel);

  // Push initial srcdoc content.
  if (getRawHtml) {
    try {
      const raw = getRawHtml(fsPath);
      const wrapped = wrapWithBase(raw, previewUrl);
      panel.webview.postMessage({ type: 'gossamer-srcdoc', html: wrapped });
    } catch (err) {
      captureException(err, { context: 'showPreview_srcdoc_push' });
    }
  }
  t.end();
}

export function disposeAllPreviews() {
  panels.forEach((p) => p.dispose());
  panels.clear();
}
