import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Default false for shipped builds. Flip to true locally to emit per-step
// timings to the "Gossamer Preview Perf" output channel AND to a tail-friendly
// file at $TMPDIR/gossamer-preview-debug/lifecycle.log.
const PERF_HOST_ENABLED = false;

// File log path: ~/Library/Application Support/Cursor/User/globalStorage/
// ashvinbondada.gossamer-preview/dispose.log (and on Linux ~/.config/Cursor/...).
// We compute this once eagerly so we can write to it even from deactivate(),
// where the output channel may have already been torn down. Synchronous
// fs.appendFileSync is intentional — we WANT it to flush before the process
// dies, even if it costs 1-2ms per call.
const LOG_FILE = (() => {
  try {
    const dir = path.join(os.tmpdir(), 'gossamer-preview-debug');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return path.join(dir, 'lifecycle.log');
  } catch { return ''; }
})();

let _stamp0 = 0;
function ts(): string { return new Date().toISOString(); }

// One-shot logger that writes to the perf output channel AND a disk file.
// Both targets matter:
//   - Output channel for interactive viewing while Cursor is alive.
//   - Disk file so we can read it after a hung reload — output channel can be
//     lost during a force-quit or extension host crash.
export function perfMark(name: string): void {
  if (!PERF_HOST_ENABLED) return;
  if (_stamp0 === 0) _stamp0 = Date.now();
  const dt = Date.now() - _stamp0;
  const line = `[+${dt.toString().padStart(6)} ms] ${name}`;

  // 1) Output channel (best-effort)
  try {
    const ch = ensureChannel();
    ch?.appendLine(line);
  } catch {}

  // 2) Disk file (synchronous, MUST flush before process exit)
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, `${ts()} pid=${process.pid} ${line}\n`);
    } catch {}
  }
}

// Read by integration tests / diagnostics.
export function getDiagnosticLogPath(): string { return LOG_FILE; }

let channel: vscode.OutputChannel | undefined;

function ensureChannel(): vscode.OutputChannel | undefined {
  if (!PERF_HOST_ENABLED) return undefined;
  if (!channel) channel = vscode.window.createOutputChannel('Gossamer Preview Perf');
  return channel;
}

// Start a timing scope. Returns a function to mark sub-steps and a finalizer.
//
// Usage:
//   const t = perfScope('previewPanel.showPreview', fsPath);
//   t.mark('buildHtml start');
//   const html = buildHtml(...);
//   t.mark('buildHtml done');
//   panel.webview.html = html;
//   t.mark('webview.html assigned');
//   t.end();
export function perfScope(label: string, detail?: string) {
  if (!PERF_HOST_ENABLED) {
    // Zero-overhead no-ops when the flag is off.
    return { mark: (_: string) => {}, end: () => {} };
  }
  const ch = ensureChannel()!;
  const t0 = process.hrtime.bigint();
  let last = t0;
  const lines: string[] = [];
  const header = `\n[${label}]${detail ? ' ' + detail : ''}`;
  lines.push(header);
  return {
    mark(name: string) {
      const now = process.hrtime.bigint();
      const dt = Number(now - last) / 1e6;
      const total = Number(now - t0) / 1e6;
      lines.push(`  +${dt.toFixed(2).padStart(7)} ms  (${total.toFixed(2).padStart(7)} ms total)  ${name}`);
      last = now;
    },
    end() {
      const total = Number(process.hrtime.bigint() - t0) / 1e6;
      lines.push(`  end: ${total.toFixed(2)} ms total`);
      ch.appendLine(lines.join('\n'));
    },
  };
}
