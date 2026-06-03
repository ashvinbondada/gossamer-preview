import * as vscode from 'vscode';

// Default false for shipped builds. Flip to true locally to emit per-step
// timings to the "Gossamer Preview Perf" output channel.
const PERF_HOST_ENABLED = false;

// One-shot logger that writes to the same channel as perfScope. Useful for
// activation-lifecycle marks that aren't a single scoped operation.
let _stamp0 = 0;
export function perfMark(name: string): void {
  if (!PERF_HOST_ENABLED) return;
  const ch = ensureChannel();
  if (!ch) return;
  if (_stamp0 === 0) _stamp0 = Date.now();
  ch.appendLine(`[+${(Date.now() - _stamp0).toString().padStart(6)} ms] ${name}`);
}

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
