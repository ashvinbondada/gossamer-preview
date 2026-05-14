import * as vscode from 'vscode';
import { LiveReloadServer } from './liveReload';

const CONFIG_KEY = 'gossamer-preview';
let lastOpenedUri = '';

export function registerOpenListener(
  context: vscode.ExtensionContext,
  getPreviewUrl: (fileUri: string) => string
) {
  const listener = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') {
      return;
    }
    const isHtml =
      doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) {
      return;
    }
    const uriString = doc.uri.toString();
    if (uriString === lastOpenedUri) {
      return;
    }
    lastOpenedUri = uriString;

    const openEditor = vscode.workspace
      .getConfiguration(CONFIG_KEY)
      .get<boolean>('openEditor', false);

    const previewUrl = getPreviewUrl(uriString);
    vscode.commands.executeCommand('simpleBrowser.show', previewUrl).then(() => {
      if (!openEditor) {
        vscode.window.tabGroups.all.forEach((group) => {
          group.tabs.forEach((tab) => {
            if (
              tab.input instanceof vscode.TabInputText &&
              tab.input.uri.toString() === uriString
            ) {
              vscode.window.tabGroups.close(tab);
            }
          });
        });
      }
    });
  });

  context.subscriptions.push(listener);
}

export async function activate(context: vscode.ExtensionContext) {
  const server = new LiveReloadServer();
  await server.start();

  context.subscriptions.push({ dispose: () => server.dispose() });

  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') return;
    const isHtml = doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) return;
    server.setFile(doc.fileName);
    server.reload();
  });
  context.subscriptions.push(saveListener);

  registerOpenListener(context, (fileUri: string) => {
    const filePath = vscode.Uri.parse(fileUri).fsPath;
    server.setFile(filePath);
    return `http://127.0.0.1:${server.port}/`;
  });
}

export function deactivate() {}
