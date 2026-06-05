#!/usr/bin/env node
// Build a standalone single-file `gossamer` executable for the HOST OS using
// Node's built-in Single Executable Applications (SEA).
//
// Why SEA instead of pkg: SEA ships with Node, needs no external base-binary
// downloads, and builds a native binary from whatever Node is running it. That
// makes it reproducible and CI-friendly — each OS runner (Linux container,
// Windows VM, macOS VM) produces its own native binary by running this exact
// script. pkg, by contrast, fetches prebuilt bases that aren't always available
// and otherwise falls back to compiling Node from source.
//
// Pipeline: esbuild bundles src/ (zero runtime deps + the inlined package.json)
// into one CommonJS file → `--experimental-sea-config` produces a blob → we copy
// the running Node binary and inject the blob with postject → (macOS) re-sign.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const buildDir = join(pkgRoot, 'build');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const arch = process.arch; // x64 | arm64
const osName = isWin ? 'win' : isMac ? 'macos' : 'linux';
const binName = `gossamer${isWin ? '.exe' : ''}`;
const distName = `gossamer-${osName}-${arch}${isWin ? '.exe' : ''}`;
const binPath = join(buildDir, binName);
const distPath = join(buildDir, distName);
const bundlePath = join(buildDir, 'bundle.cjs');
const blobPath = join(buildDir, 'sea-prep.blob');
const seaConfigPath = join(buildDir, 'sea-config.json');

function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

async function main() {
  console.log(`Building gossamer binary for ${osName}-${arch} (Node ${process.version})`);
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  // 1. Bundle TypeScript sources (and the inlined package.json) into one CJS file.
  console.log('→ bundling with esbuild');
  await build({
    entryPoints: [join(pkgRoot, 'src/cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundlePath,
    // Node builtins (including node:sea) are provided at runtime.
    external: ['node:sea'],
    loader: { '.json': 'json' },
    logLevel: 'info',
  });

  // 2. Produce the SEA preparation blob from the bundle.
  console.log('→ generating SEA blob');
  writeFileSync(seaConfigPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2));
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  // 3. Copy the running Node binary as our executable shell.
  console.log('→ copying Node binary');
  copyFileSync(process.execPath, binPath);
  if (!isWin) chmodSync(binPath, 0o755);

  // macOS: strip the existing signature before injecting, or codesign rejects it.
  if (isMac) {
    try { run('codesign', ['--remove-signature', binPath]); } catch {}
  }

  // 4. Inject the blob with postject (fuse sentinel + macOS segment name).
  console.log('→ injecting SEA blob with postject');
  const postject = require.resolve('postject/dist/cli.js');
  const postjectArgs = [postject, binPath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL];
  if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  run(process.execPath, postjectArgs);

  // macOS: re-sign ad-hoc so Gatekeeper will run the binary.
  if (isMac) {
    try { run('codesign', ['--sign', '-', binPath]); } catch {}
  }

  // 5. Name the artifact per-OS/arch and verify it runs.
  copyFileSync(binPath, distPath);
  if (!isWin) chmodSync(distPath, 0o755);

  console.log('→ verifying');
  const out = execFileSync(distPath, ['version'], { encoding: 'utf8' }).trim();
  const size = (statSync(distPath).size / 1024 / 1024).toFixed(1);
  if (!/^\d+\.\d+\.\d+/.test(out)) throw new Error(`unexpected version output: ${out}`);
  console.log(`\n✓ Built ${distName} (${size} MB), reports version ${out}`);
}

main().catch((err) => {
  console.error('\nBINARY BUILD FAILED:', err.message || err);
  process.exit(1);
});
