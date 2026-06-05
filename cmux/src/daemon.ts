import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ping, PingResult } from './client';

// Where the detached daemon writes its log, so a crashed/odd daemon can be
// diagnosed after the fact (the spawning terminal is long gone by then).
export function logDir(): string {
  const dir = path.join(os.homedir(), '.gossamer-cmux');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure a preview daemon is listening on `port`, spawning a detached one if
 * needed. Returns the daemon's ping payload once it is reachable.
 *
 * The daemon is the single source of truth for which files are registered and
 * which browser tabs are connected, so a second `gossamer open` simply talks to
 * the already-running daemon instead of starting a competing server.
 */
export async function ensureDaemon(port: number): Promise<PingResult> {
  const existing = await ping(port);
  if (existing && existing.gossamer) return existing;

  // Spawn `gossamer serve` detached, with stdio redirected to a log file so it
  // outlives the terminal that launched it.
  //
  // How we re-invoke ourselves depends on how we're running:
  //  - As a packaged single-file binary (pkg / Node SEA), process.execPath IS
  //    the gossamer binary, so we pass the subcommand directly.
  //  - As plain `node dist/cli.js`, process.execPath is node, so we must pass
  //    the cli.js entry script before the subcommand.
  const out = fs.openSync(path.join(logDir(), 'daemon.log'), 'a');
  const args = isPackagedBinary()
    ? ['serve', '--port', String(port)]
    : [path.join(__dirname, 'cli.js'), 'serve', '--port', String(port)];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  // Poll until it answers (or give up after ~6s).
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    await sleep(150);
    const info = await ping(port);
    if (info && info.gossamer) return info;
  }
  throw new Error(`Preview daemon did not come up on port ${port}. See ${path.join(logDir(), 'daemon.log')}`);
}

/** True when running as a pkg or Node SEA single-file executable. */
export function isPackagedBinary(): boolean {
  if ((process as unknown as { pkg?: unknown }).pkg) return true;
  try {
    // node:sea is available on Node 20+; isSea() throws/missing otherwise.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sea = require('node:sea') as { isSea?: () => boolean };
    if (sea && typeof sea.isSea === 'function' && sea.isSea()) return true;
  } catch { /* not a SEA build */ }
  return false;
}
