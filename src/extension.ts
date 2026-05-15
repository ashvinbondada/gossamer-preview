import * as vscode from 'vscode';
import { LiveReloadServer } from './liveReload';
import { registerDiffCommand } from './diffView';

const CONFIG_KEY = 'gossamer-preview';
const openedUris = new Set<string>();

function openPreview(
  doc: vscode.TextDocument,
  getPreviewUrl: (fileUri: string) => string
) {
  if (doc.uri.scheme !== 'file') return;
  const isHtml = doc.languageId === 'html' || doc.fileName.endsWith('.html');
  if (!isHtml) return;

  const uriString = doc.uri.toString();
  if (openedUris.has(uriString)) return;
  openedUris.add(uriString);

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
}

export function registerOpenListener(
  context: vscode.ExtensionContext,
  getPreviewUrl: (fileUri: string) => string
) {
  const listener = vscode.workspace.onDidOpenTextDocument((doc) => {
    openPreview(doc, getPreviewUrl);
  });
  context.subscriptions.push(listener);
}

export async function activate(context: vscode.ExtensionContext) {
  const server = new LiveReloadServer();
  await server.start();

  context.subscriptions.push({ dispose: () => server.dispose() });

  // Multi-file: track clients per file path, serve based on request URL
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const doc = event.document;
    if (doc.uri.scheme !== 'file') return;
    const isHtml = doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) return;
    const existing = debounceTimers.get(doc.fileName);
    if (existing) clearTimeout(existing);
    debounceTimers.set(doc.fileName, setTimeout(() => server.reload(doc.fileName), 500));
  });
  context.subscriptions.push(changeListener);

  const getPreviewUrl = (fileUri: string) => {
    const filePath = vscode.Uri.parse(fileUri).fsPath;
    const urlPath = server.setFile(filePath);
    return `http://127.0.0.1:${server.port}${urlPath}`;
  };

  registerOpenListener(context, getPreviewUrl);

  // Fix: handle already-open HTML files on activation (first-open bug)
  vscode.window.visibleTextEditors.forEach((editor) => {
    openPreview(editor.document, getPreviewUrl);
  });

  registerDiffCommand(context);
}

export function deactivate() {}
