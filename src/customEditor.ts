import * as vscode from 'vscode';
import * as path from 'path';
import { buildHtml } from './previewPanel';

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
    panel.webview.options = { enableScripts: true };
    const previewUrl = this.getPreviewUrl(document.uri.fsPath);
    panel.webview.html = buildHtml(previewUrl, path.basename(document.uri.fsPath));

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
