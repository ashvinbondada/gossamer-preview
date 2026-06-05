#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { PreviewServer, DEFAULT_PORT } from './server';
import { ping, register, shutdown } from './client';
import { ensureDaemon } from './daemon';
import { insideCmux, hasCmuxCli, openInCmux } from './cmux';

// Literal require so pkg's static analysis bundles package.json into the
// single-file binary (a path.join(...) require would not be detected).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };
const VERSION = pkg.version;

interface Flags {
  port: number;
  split?: boolean;       // explicit --split / --no-split, else auto
  open: boolean;         // whether to drive cmux (open command)
  positional: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { port: DEFAULT_PORT, open: true, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') { flags.port = parseInt(argv[++i], 10) || DEFAULT_PORT; }
    else if (a.startsWith('--port=')) { flags.port = parseInt(a.slice(7), 10) || DEFAULT_PORT; }
    else if (a === '--split') { flags.split = true; }
    else if (a === '--no-split' || a === '--tab') { flags.split = false; }
    else if (a === '--no-open' || a === '--url-only') { flags.open = false; }
    else if (a === '-h' || a === '--help') { flags.positional.push('help'); }
    else { flags.positional.push(a); }
  }
  return flags;
}

const HELP = `gossamer — live HTML preview for cmux (v${VERSION})

Usage:
  gossamer open <file.html> [options]   Preview a file in cmux's browser, live-reloaded
  gossamer serve [--port N]             Start the preview daemon (usually automatic)
  gossamer status                       Show the running daemon and registered files
  gossamer stop                         Stop the preview daemon
  gossamer version

Options:
  -p, --port <N>     Port to serve on (default ${DEFAULT_PORT})
  --split            Open the browser beside the current pane (default inside cmux)
  --no-split, --tab  Open the browser as a new surface instead of splitting
  --no-open          Only register/serve; print the URL, don't drive cmux

Examples:
  gossamer open ./index.html
  gossamer open report.html --no-split
`;

async function cmdServe(flags: Flags): Promise<number> {
  // If something already owns the port, defer to it when it's one of ours.
  const existing = await ping(flags.port);
  if (existing && existing.gossamer) {
    console.log(`gossamer daemon already running on port ${existing.port} (v${existing.version})`);
    return 0;
  }

  const server = new PreviewServer(VERSION);
  try {
    const port = await server.start(flags.port);
    console.log(`gossamer-cmux v${VERSION} serving on http://127.0.0.1:${port}`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${flags.port} is in use by another process (not gossamer). Pick another with --port.`);
    } else {
      console.error(`Failed to start preview server: ${e.message}`);
    }
    return 1;
  }

  const stop = () => { server.dispose(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Keep the process alive.
  return new Promise<number>(() => { /* never resolves; runs until signalled */ });
}

async function cmdOpen(flags: Flags): Promise<number> {
  const file = flags.positional[1];
  if (!file) { console.error('Usage: gossamer open <file.html>'); return 1; }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    console.error(`File not found: ${abs}`); return 1;
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') {
    console.error(`Not an HTML file: ${abs}`); return 1;
  }

  await ensureDaemon(flags.port);
  const reg = await register(flags.port, abs);
  if (!reg) { console.error('Failed to register file with the preview daemon.'); return 1; }

  console.log(reg.url);

  if (!flags.open) return 0;

  if (!hasCmuxCli()) {
    console.log('(cmux CLI not found — open the URL above in cmux’s browser manually.)');
    return 0;
  }
  // Default: split when we're inside a cmux terminal so the preview lands beside
  // the working pane; otherwise open a fresh browser surface.
  const split = flags.split ?? insideCmux();
  const result = await openInCmux(reg.url, { split });
  if (!result.ok) {
    console.error(`cmux open failed (${result.command}): ${result.error}`);
    console.error('Open the URL above manually in cmux’s browser.');
    return 0; // the server is up and the URL works; non-fatal
  }
  return 0;
}

async function cmdStatus(flags: Flags): Promise<number> {
  const info = await ping(flags.port);
  if (!info) { console.log(`No gossamer daemon running on port ${flags.port}.`); return 0; }
  console.log(`gossamer-cmux v${info.version} on http://127.0.0.1:${info.port}`);
  if (info.files.length === 0) {
    console.log('  (no files registered)');
  } else {
    for (const f of info.files) console.log(`  ${f}`);
  }
  return 0;
}

async function cmdStop(flags: Flags): Promise<number> {
  const ok = await shutdown(flags.port);
  console.log(ok ? 'Daemon stopped.' : `No daemon running on port ${flags.port}.`);
  return 0;
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags.positional[0];
  switch (cmd) {
    case 'open': return cmdOpen(flags);
    case 'serve': return cmdServe(flags);
    case 'status': return cmdStatus(flags);
    case 'stop': return cmdStop(flags);
    case 'version': case '--version': case '-v': console.log(VERSION); return 0;
    case undefined: case 'help': default:
      console.log(HELP); return cmd && cmd !== 'help' ? 1 : 0;
  }
}

main().then((code) => { if (code) process.exitCode = code; }).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
