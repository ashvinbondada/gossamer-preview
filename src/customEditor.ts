import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml } from './previewPanel';
import { perfScope } from './perf';
import { capture, captureException } from './posthog';
import { dispatchHostKey } from './hostKeys';

export const VIEW_TYPE = 'gossamer-preview.html';

function renderErrorHtml(title: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const escaped = msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>
html,body{height:100%;margin:0;background:#0d0d0f;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:24px}
.box{max-width:480px;text-align:center}
.title{font-size:15px;font-weight:600;margin-bottom:6px}
.msg{font-size:12.5px;color:#8a8a93;line-height:1.55}
code{font-family:'SF Mono','JetBrains Mono',ui-monospace,monospace;font-size:12px;background:#1a1a1f;padding:2px 6px;border-radius:4px;color:#d4d4dc}
</style></head><body><div class="box"><div class="title">Preview unavailable</div><div class="msg">Gossamer Preview couldn't start its background server.<br><br><code>${escaped}</code><br><br>Reload the window to retry.</div></div></body></html>`;
}

// Exposed for integration tests. The number of times the resolve path took the
// slow placeholder branch — must stay 0 in the steady-state for shortcut
// pass-through invariants to hold (see memory: feedback_cmd_shortcut_passthrough_invariant).
export const __test = {
  placeholderUseCount: 0,
  webviewHtmlAssignCount: 0,
  reset() { this.placeholderUseCount = 0; this.webviewHtmlAssignCount = 0; },
};

export class GossamerHtmlEditor implements vscode.CustomTextEditorProvider {
  constructor(
    private context: vscode.ExtensionContext,
    private getPreviewUrl: (fsPath: string) => string,
    private serverReady: Promise<unknown>
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const t = perfScope('customEditor.resolve', document.uri.fsPath);
    const __t0 = Date.now();
    const __dbg = (msg: string) => {
      try { console.log('[gossamer] resolve ' + path.basename(document.uri.fsPath) + ' +' + (Date.now() - __t0) + 'ms ' + msg); } catch {}
    };
    __dbg('start');
    panel.webview.options = { enableScripts: true };
    t.mark('webview.options set');
    __dbg('webview.options set');

    // Wait for the live-reload server to be ready. NO placeholder, NO double
    // panel.webview.html assignment — both broke shortcut forwarding (Cmd+P/C/V).
    try {
      await this.serverReady;
    } catch (err) {
      __dbg('serverReady REJECTED ' + (err instanceof Error ? err.message : String(err)));
      captureException(err, { context: 'custom_editor_server_ready' });
      panel.webview.html = renderErrorHtml(path.basename(document.uri.fsPath), err);
      __test.webviewHtmlAssignCount++;
      return;
    }
    t.mark('server ready');
    __dbg('serverReady resolved');

    const previewUrl = this.getPreviewUrl(document.uri.fsPath);
    t.mark('getPreviewUrl done');
    __dbg('getPreviewUrl ' + previewUrl);
    const copyPath = vscode.workspace.asRelativePath(document.uri.fsPath, false);
    t.mark('asRelativePath done');
    const html = buildHtml(previewUrl, path.basename(document.uri.fsPath), copyPath);
    t.mark(`buildHtml done (${html.length} chars)`);
    __dbg('buildHtml ' + html.length + ' chars');
    panel.webview.html = html;
    __test.webviewHtmlAssignCount++;
    t.mark('webview.html assigned');
    __dbg('webview.html assigned — DONE');
    t.end();
    capture('preview opened via custom editor', { method: 'custom_editor' });

    let sourceEditorOpen = false;

    const syncToggleState = () => {
      const isOpen = vscode.window.visibleTextEditors.some(
        (e) => e.document.uri.toString() === document.uri.toString()
      );
      if (isOpen !== sourceEditorOpen) {
        sourceEditorOpen = isOpen;
        panel.webview.postMessage({ type: 'editSourceState', open: sourceEditorOpen });
      }
    };

    const editorChangeDisposable = vscode.window.onDidChangeVisibleTextEditors(syncToggleState);
    panel.onDidDispose(() => editorChangeDisposable.dispose());

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'editSource') {
        if (sourceEditorOpen) {
          for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === document.uri.toString()) {
              await vscode.commands.executeCommand(
                'workbench.action.closeEditorsInGroup',
              );
              break;
            }
          }
        } else {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default',
            { viewColumn: vscode.ViewColumn.Beside }
          );
        }
      } else if (msg?.type === 'host-key') {
        try {
          const ran = await dispatchHostKey(msg);
          if (ran) capture('host_key_dispatched', { command: ran });
        } catch (err) {
          captureException(err, { context: 'host_key_dispatch' });
        }
      }
    });
  }
}
