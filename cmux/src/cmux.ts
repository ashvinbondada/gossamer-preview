import { execFile, execFileSync } from 'child_process';

// Thin bridge to the cmux CLI. cmux exposes its embedded browser through the
// `cmux browser ...` subcommands (open / open-split / navigate / reload / ...),
// all of which talk to the running app over its Unix socket. We only need to
// open a URL; live reload after that is handled entirely by our SSE client, so
// we never have to track surface ids.

/** True when we appear to be running inside a cmux-managed terminal surface. */
export function insideCmux(): boolean {
  return !!(
    process.env.CMUX_SOCKET_PATH ||
    process.env.CMUX_SURFACE_ID ||
    process.env.CMUX_WORKSPACE_ID
  );
}

/** True when the `cmux` CLI is on PATH. */
export function hasCmuxCli(): boolean {
  try {
    execFileSync('cmux', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export interface OpenOptions {
  /** Split the current pane and put the browser beside it (cmux: open-split). */
  split?: boolean;
}

export interface OpenResult {
  ok: boolean;
  /** The cmux subcommand we invoked, for logging. */
  command: string;
  error?: string;
}

/**
 * Open a URL in cmux's embedded browser.
 *
 * When `split` is requested (the default inside a cmux terminal), we use
 * `cmux browser open-split` so the preview appears next to the terminal the
 * agent/user is working in. Otherwise we use `cmux browser open`, which opens a
 * fresh browser surface.
 */
export function openInCmux(url: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const sub = opts.split ? 'open-split' : 'open';
  const args = ['browser', sub, url];
  const command = `cmux ${args.join(' ')}`;
  return new Promise((resolve) => {
    execFile('cmux', args, { timeout: 8000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, command, error: (stderr && stderr.toString().trim()) || err.message });
      } else {
        resolve({ ok: true, command });
      }
    });
  });
}
