import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml } from './previewPanel';
import { perfScope } from './perf';

export const VIEW_TYPE = 'gossamer-preview.html';

export class GossamerHtmlEditor implements vscode.CustomTextEditorProvider {
  constructor(
    private context: vscode.ExtensionContext,
    private getPreviewUrl: (fsPath: string) => string
  ) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): void {
    const t = perfScope('customEditor.resolve', document.uri.fsPath);
    panel.webview.options = { enableScripts: true };
    t.mark('webview.options set');
    const previewUrl = this.getPreviewUrl(document.uri.fsPath);
    t.mark('getPreviewUrl done');
    const copyPath = vscode.workspace.asRelativePath(document.uri.fsPath, false);
    t.mark('asRelativePath done');
    const html = buildHtml(previewUrl, path.basename(document.uri.fsPath), copyPath);
    t.mark(`buildHtml done (${html.length} chars)`);
    panel.webview.html = html;
    t.mark('webview.html assigned');
    t.end();

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
      }
    });
  }
}
