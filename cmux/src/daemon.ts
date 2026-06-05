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
  const out = fs.openSync(path.join(logDir(), 'daemon.log'), 'a');
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'cli.js'), 'serve', '--port', String(port)],
    { detached: true, stdio: ['ignore', out, out] }
  );
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
