import * as vscode from 'vscode';
import { LiveReloadServer } from './liveReload';
import { registerDiffCommand } from './diffView';
import { showPreview, disposeAllPreviews } from './previewPanel';
import { GossamerHtmlEditor, VIEW_TYPE } from './customEditor';
import { initPostHog, capture, captureException, shutdownPostHog } from './posthog';
import { perfMark } from './perf';
perfMark('extension.js module loaded');

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
    capture('changelog viewed', { previous_version: lastVersion, current_version: currentVersion });
    vscode.commands.executeCommand(
      'extension.open',
      'ashvinbondada.gossamer-preview',
      'changelog'
    );
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  perfMark('activate() entry');
  const __activateStart = Date.now();
  showUpdateNotification(context);
  perfMark('showUpdateNotification kicked off');
  const server = new LiveReloadServer();
  perfMark('LiveReloadServer constructed');

  const ext = vscode.extensions.getExtension('ashvinbondada.gossamer-preview');
  const version = (ext?.packageJSON?.version as string) ?? 'unknown';

  setImmediate(() => {
    perfMark('setImmediate: initPostHog starting');
    try { initPostHog(vscode.env.machineId, version); } catch {}
    perfMark('setImmediate: initPostHog returned');
  });

  perfMark('about to call server.start()');
  const serverReady = server.start().catch((err) => {
    captureException(err, { context: 'server_start' });
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Gossamer Preview: failed to start preview server (${msg}). Reload window to retry.`
    );
    throw err;
  });

  perfMark('server.start() returned (Promise)');
  serverReady.then(
    (p) => perfMark('serverReady RESOLVED port=' + p),
    (e) => perfMark('serverReady REJECTED ' + (e instanceof Error ? e.message : String(e)))
  );

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
      new GossamerHtmlEditor(context, getPreviewUrl, serverReady),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
    )
  );

  // Manual command: forces the preview panel (independent of custom editor binding).
  const openCmd = vscode.commands.registerCommand('gossamer-preview.open', async () => {
    try { await serverReady; } catch {
      vscode.window.showErrorMessage('Gossamer Preview: server failed to start. Reload window.');
      return;
    }
    const editor = vscode.window.activeTextEditor;
    let doc: vscode.TextDocument | undefined = editor?.document;
    if (!doc) {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE) {
        vscode.workspace.openTextDocument(tab.input.uri).then((d) => {
          if (d.isDirty) server.setBufferText(d.fileName, d.getText());
          showPreview(d.fileName, getPreviewUrl(d.fileName));
          capture('preview opened', { method: 'command' });
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
    capture('preview opened', { method: 'command' });
  });
  context.subscriptions.push(openCmd);

  registerDiffCommand(context);

  exportedApi = {
    serverPort: () => server.port,
    urlPathFor: (fsPath: string) => server.setFile(fsPath),
  };
  perfMark('activate() returning after ' + (Date.now() - __activateStart) + 'ms');
  return exportedApi;
}

export function deactivate() {
  // Fire-and-forget PostHog shutdown with a tight cap so we never block window
  // reload on a network flush. If the SDK hangs, we'd rather lose a few queued
  // events than freeze the editor.
  try {
    Promise.race([
      shutdownPostHog(),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ]).catch(() => {});
  } catch {}
  // IMPORTANT: do NOT return a Promise here. VS Code awaits the deactivate
  // return value, and any slow async work blocks reload.
}
