import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildDiffHtml } from './diffHtml';

async function pickHtmlFile(prompt: string): Promise<string | undefined> {
  const files = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');
  if (files.length === 0) {
    vscode.window.showErrorMessage('No HTML files found in workspace.');
    return undefined;
  }
  const items = files.map((f) => ({
    label: path.basename(f.fsPath),
    description: vscode.workspace.asRelativePath(f),
    fsPath: f.fsPath,
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: prompt });
  return pick?.fsPath;
}

export function registerDiffCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('gossamer-preview.compareFiles', async () => {
    const pathA = await pickHtmlFile('Select first HTML file (base)');
    if (!pathA) return;

    const pathB = await pickHtmlFile('Select second HTML file (compare)');
    if (!pathB) return;

    let htmlA: string;
    let htmlB: string;
    try {
      htmlA = fs.readFileSync(pathA, 'utf8');
      htmlB = fs.readFileSync(pathB, 'utf8');
    } catch (e) {
      vscode.window.showErrorMessage('Failed to read HTML files.');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gossamerDiff',
      `Diff: ${path.basename(pathA)} ↔ ${path.basename(pathB)}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = buildDiffHtml(
      htmlA,
      htmlB,
      path.basename(pathA),
      path.basename(pathB)
    );
  });

  context.subscriptions.push(cmd);
}
