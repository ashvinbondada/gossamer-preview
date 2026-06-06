import * as vscode from 'vscode';
import { LiveReloadServer } from './liveReload';
import { registerDiffCommand } from './diffView';
import { showPreview, disposeAllPreviews } from './previewPanel';
import { GossamerHtmlEditor, VIEW_TYPE } from './customEditor';
import { setIdentity, connectPostHog, capture, captureException, shutdownPostHog } from './posthog';
import { perfMark } from './perf';
import { panelsFor } from './panelRegistry';
import { wrapWithBase } from './previewHtml';
perfMark('========== EXTENSION HOST START pid=' + process.pid + ' ==========');
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

  // Set identity SYNCHRONOUSLY so any capture/captureException fired during
  // activation (before the SDK finishes connecting) carries the correct
  // distinctId. The actual SDK connect is deferred via setImmediate to keep
  // it off the activation critical path.
  setIdentity(vscode.env.machineId, version);

  // Telemetry is gated ONLY by our own per-extension opt-in. The global VS
  // Code `telemetry.telemetryLevel` setting is no longer a gate (changed in
  // 2.1.4). Users who want Gossamer telemetry off can set
  // `gossamer-preview.telemetry.enabled` to false. Documented in PRIVACY.md,
  // README.md, the setting's description in package.json, and CHANGELOG.md.
  const userOptedIn = vscode.workspace
    .getConfiguration('gossamer-preview')
    .get<boolean>('telemetry.enabled', true);

  if (userOptedIn) {
    setImmediate(() => {
      perfMark('setImmediate: connectPostHog starting');
      try { connectPostHog(); } catch {}
      perfMark('setImmediate: connectPostHog returned');
      capture('extension activated', { vscode_version: vscode.version });
    });
  } else {
    perfMark(`telemetry disabled (gossamer-preview.telemetry.enabled=false)`);
  }

  // Honor runtime changes to our own telemetry switch. The global VS Code
  // setting is intentionally not listened for — see 2.1.4 release notes.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('gossamer-preview.telemetry.enabled')) return;
    const nowEnabled = vscode.workspace.getConfiguration('gossamer-preview').get<boolean>('telemetry.enabled', true);
    if (!nowEnabled) {
      shutdownPostHog().catch(() => {});
    } else {
      try { connectPostHog(); } catch {}
    }
  }));

  // Wire the server's reload-requested signal to broadcast via webview.postMessage.
  // Replaces the WebSocket-based reload that was the root cause of window-reload
  // hangs (Cursor's webview disposal awaited ws.close handshake for 30-60s).
  server.onReloadRequested((fsPath) => {
    const panels = panelsFor(fsPath);
    perfMark(`reload(${require('path').basename(fsPath)}) → ${panels.length} panel(s)`);
    if (panels.length === 0) return;
    try {
      const raw = server.getRawHtml(fsPath);
      const previewUrl = `http://127.0.0.1:${server.port}${server.setFile(fsPath)}`;
      const html = wrapWithBase(raw, previewUrl);
      let posted = 0;
      panels.forEach((p) => {
        try {
          p.webview.postMessage({ type: 'gossamer-srcdoc', html });
          posted++;
        } catch (err: any) {
          perfMark(`  postMessage threw: ${err?.message}`);
        }
      });
      perfMark(`  posted gossamer-srcdoc (${html.length} chars) to ${posted} panel(s)`);
    } catch (err: any) {
      perfMark(`  reload broadcast threw: ${err?.message}`);
    }
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

  // CRITICAL: disposal MUST be synchronous-fast (<10ms) and never await async work.
  // VS Code waits for every disposable when the extension host shuts down, and
  // a slow dispose makes window reload hang because the previous extension
  // host can't terminate cleanly.
  context.subscriptions.push({
    dispose: () => {
      perfMark('subscription.dispose start');
      // Snapshot handles BEFORE our cleanup so we can compare with deactivate.
      try {
        const handles = (process as any)._getActiveHandles?.() ?? [];
        perfMark(`  before-cleanup handles: ${handles.length} (${handles.map((h: any) => h?.constructor?.name).slice(0, 12).join(',')})`);
      } catch {}
      try { server.dispose(); } catch (err) { perfMark('server.dispose threw ' + (err as any)?.message); }
      try { disposeAllPreviews(); } catch (err) { perfMark('disposeAllPreviews threw ' + (err as any)?.message); }
      try {
        const handles = (process as any)._getActiveHandles?.() ?? [];
        perfMark(`  after-cleanup handles: ${handles.length} (${handles.map((h: any) => h?.constructor?.name).slice(0, 12).join(',')})`);
      } catch {}
      perfMark('subscription.dispose done');
    }
  });

  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const isHtmlDoc = (doc: vscode.TextDocument) =>
    doc.uri.scheme === 'file' && (doc.languageId === 'html' || doc.fileName.endsWith('.html'));

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const doc = event.document;
    if (!isHtmlDoc(doc)) return;
    perfMark(`onDidChangeTextDocument: ${require('path').basename(doc.fileName)} (queue 300ms debounce)`);
    server.setBufferText(doc.fileName, doc.getText());
    const existing = debounceTimers.get(doc.fileName);
    if (existing) clearTimeout(existing);
    debounceTimers.set(doc.fileName, setTimeout(() => {
      perfMark(`debounce fired → server.reload(${require('path').basename(doc.fileName)})`);
      server.reload(doc.fileName);
    }, 300));
  });
  context.subscriptions.push(changeListener);

  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!isHtmlDoc(doc)) return;
    perfMark(`onDidSaveTextDocument: ${require('path').basename(doc.fileName)} → reload`);
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
      new GossamerHtmlEditor(context, getPreviewUrl, serverReady, (fsPath) => server.getRawHtml(fsPath)),
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
          showPreview(d.fileName, getPreviewUrl(d.fileName), (p) => server.getRawHtml(p));
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
    showPreview(doc.fileName, getPreviewUrl(doc.fileName), (p) => server.getRawHtml(p));
    capture('preview opened', { method: 'command' });
  });
  context.subscriptions.push(openCmd);

  registerDiffCommand(context);

  exportedApi = {
    serverPort: () => server.port,
    urlPathFor: (fsPath: string) => server.setFile(fsPath),
  };

  // Heartbeat: log every 500ms so we can see whether the extension host is
  // alive during the post-activate / pre-deactivate quiet period. If the
  // heartbeats stop firing before deactivate(), the event loop is starved.
  // If they keep firing right up to deactivate, then we're alive and the
  // hang is in Cursor's renderer/main-process awaiting something else.
  let __heartbeat = 0;
  const __heartbeatTimer = setInterval(() => {
    __heartbeat++;
    perfMark(`♥ heartbeat #${__heartbeat}`);
  }, 500);
  context.subscriptions.push({ dispose: () => clearInterval(__heartbeatTimer) });

  perfMark('activate() returning after ' + (Date.now() - __activateStart) + 'ms');
  return exportedApi;
}

export function deactivate() {
  perfMark('========== deactivate() called pid=' + process.pid + ' ==========');

  // Snapshot what's keeping the event loop alive. If this list is non-trivial
  // when we return from deactivate(), Cursor's main process can't terminate
  // our extension host until all those handles close — which IS the reload hang.
  try {
    const handles = (process as any)._getActiveHandles?.() ?? [];
    const requests = (process as any)._getActiveRequests?.() ?? [];
    perfMark(`active handles: ${handles.length} (types: ${handles.map((h: any) => h?.constructor?.name).slice(0, 20).join(', ')})`);
    perfMark(`active requests: ${requests.length} (types: ${requests.map((r: any) => r?.constructor?.name).slice(0, 20).join(', ')})`);
  } catch (err: any) { perfMark('handle snapshot threw: ' + err?.message); }

  // Fire-and-forget PostHog shutdown with a tight cap so we never block window
  // reload on a network flush. If the SDK hangs, we'd rather lose a few queued
  // events than freeze the editor.
  try {
    Promise.race([
      shutdownPostHog(),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ]).catch(() => {});
  } catch {}
  // Watchdog: 100ms after we return, snapshot handles again. If the process
  // is still alive at this point with active handles, that's our hang.
  // setImmediate also fires once the call stack clears, so we see the
  // "right after deactivate" state too.
  try {
    setImmediate(() => {
      const handles = (process as any)._getActiveHandles?.() ?? [];
      perfMark(`[setImmediate after deactivate] handles=${handles.length} types=${handles.map((h: any) => h?.constructor?.name).slice(0, 30).join(',')}`);
    });
    setTimeout(() => {
      const handles = (process as any)._getActiveHandles?.() ?? [];
      perfMark(`[+100ms after deactivate] handles=${handles.length} types=${handles.map((h: any) => h?.constructor?.name).slice(0, 30).join(',')}`);
    }, 100);
    setTimeout(() => {
      const handles = (process as any)._getActiveHandles?.() ?? [];
      perfMark(`[+1000ms after deactivate] handles=${handles.length} types=${handles.map((h: any) => h?.constructor?.name).slice(0, 30).join(',')}`);
    }, 1000);
  } catch {}

  perfMark('deactivate() returning');
  // IMPORTANT: do NOT return a Promise here. VS Code awaits the deactivate
  // return value, and any slow async work blocks reload.
}
