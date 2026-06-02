import * as vscode from 'vscode';
import { LiveReloadServer } from './liveReload';
import { registerDiffCommand } from './diffView';
import { showPreview, disposeAllPreviews } from './previewPanel';
import { GossamerHtmlEditor, VIEW_TYPE } from './customEditor';

interface ExtensionApi {
  serverPort(): number;
  urlPathFor(fsPath: string): string;
}

let exportedApi: ExtensionApi | undefined;

async function showUpdateNotification(context: vscode.ExtensionContext) {
  const ext = vscode.extensions.getExtension('ashvinbondada.gossamer-preview');
  const currentVersion = ext?.packageJSON?.version as string | undefined;
  if (!currentVersion) return;
  const lastVersion = context.globalState.get<string>('lastSeenVersion');
  if (lastVersion === currentVersion) return;
  await context.globalState.update('lastSeenVersion', currentVersion);
  if (!lastVersion) return; // first install, skip notification
  const action = await vscode.window.showInformationMessage(
    `Gossamer Preview updated to v${currentVersion} — see what's new.`,
    'View Changelog'
  );
  if (action === 'View Changelog') {
    vscode.commands.executeCommand(
      'extension.open',
      'ashvinbondada.gossamer-preview',
      'changelog'
    );
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  showUpdateNotification(context);
  const server = new LiveReloadServer();
  await server.start();

  context.subscriptions.push({ dispose: () => { server.dispose(); disposeAllPreviews(); } });

  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const isHtmlDoc = (doc: vscode.TextDocument) =>
    doc.uri.scheme === 'file' && (doc.languageId === 'html' || doc.fileName.endsWith('.html'));

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const doc = event.document;
    if (!isHtmlDoc(doc)) return;
    server.setBufferText(doc.fileName, doc.getText());
    const existing = debounceTimers.get(doc.fileName);
    if (existing) clearTimeout(existing);
    debounceTimers.set(doc.fileName, setTimeout(() => server.reload(doc.fileName), 300));
  });
  context.subscriptions.push(changeListener);

  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!isHtmlDoc(doc)) return;
    server.clearBufferText(doc.fileName);
    server.reload(doc.fileName);
  });
  context.subscriptions.push(saveListener);

  const closeListener = vscode.workspace.onDidCloseTextDocument((doc) => {
    if (!isHtmlDoc(doc)) return;
    server.clearBufferText(doc.fileName);
  });
  context.subscriptions.push(closeListener);

  const getPreviewUrl = (fsPath: string) => {
    const urlPath = server.setFile(fsPath);
    return `http://127.0.0.1:${server.port}${urlPath}`;
  };

  // Custom editor: HTML files open directly as the preview, no text editor flash.
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new GossamerHtmlEditor(context, getPreviewUrl),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
    )
  );

  // Manual command: forces the preview panel (independent of custom editor binding).
  const openCmd = vscode.commands.registerCommand('gossamer-preview.open', () => {
    const editor = vscode.window.activeTextEditor;
    let doc: vscode.TextDocument | undefined = editor?.document;
    // If active tab is our custom editor, fall back to the active tab's URI.
    if (!doc) {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE) {
        vscode.workspace.openTextDocument(tab.input.uri).then((d) => {
          if (d.isDirty) server.setBufferText(d.fileName, d.getText());
          showPreview(d.fileName, getPreviewUrl(d.fileName));
        });
        return;
      }
      vscode.window.showWarningMessage('Gossamer Preview: open an HTML file first.');
      return;
    }
    if (!isHtmlDoc(doc)) {
      vscode.window.showWarningMessage('Gossamer Preview: the active file is not HTML.');
      return;
    }
    if (doc.isDirty) server.setBufferText(doc.fileName, doc.getText());
    showPreview(doc.fileName, getPreviewUrl(doc.fileName));
  });
  context.subscriptions.push(openCmd);

  registerDiffCommand(context);

  exportedApi = {
    serverPort: () => server.port,
    urlPathFor: (fsPath: string) => server.setFile(fsPath),
  };
  return exportedApi;
}

export function deactivate() {}
