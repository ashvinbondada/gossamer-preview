import * as path from 'path';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

// Allow GOSSAMER_TEST_HOST=cursor to drive the real Cursor binary instead of
// downloading vanilla VS Code. This is the only way to reproduce CSP behavior
// that differs between Cursor and stock Code (e.g. the localhost-fetch brief).
function resolveVscodePath(): string | undefined {
  const host = process.env.GOSSAMER_TEST_HOST;
  if (!host || host === 'vscode') return undefined; // download stock Code
  if (host === 'cursor') {
    const candidates = [
      '/Applications/Cursor.app/Contents/MacOS/Cursor',
      process.env.HOME + '/Applications/Cursor.app/Contents/MacOS/Cursor',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    throw new Error('GOSSAMER_TEST_HOST=cursor but Cursor.app not found in standard locations');
  }
  // Anything else: treat as an explicit path.
  if (!fs.existsSync(host)) throw new Error(`GOSSAMER_TEST_HOST path does not exist: ${host}`);
  return host;
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');
    const workspace = process.env.GOSSAMER_TEST_WORKSPACE
      || path.resolve(__dirname, '../../../src/test/fixtures');
    const vscodeExecutablePath = resolveVscodePath();
    if (vscodeExecutablePath) {
      console.log(`[gossamer-it] using host binary: ${vscodeExecutablePath}`);
    }
    console.log(`[gossamer-it] workspace: ${workspace}`);
    const launchArgs = [workspace];
    if (process.env.GOSSAMER_TEST_KEEP_EXTENSIONS !== '1') {
      launchArgs.push('--disable-extensions');
    } else {
      console.log('[gossamer-it] other extensions ENABLED');
    }

    // Headless mode. macOS Electron cannot truly hide the window without
    // forking the binary, but these flags make it as unobtrusive as possible:
    //  - off-screen rendering disables compositing onto a visible surface
    //  - no first-run window / welcome makes startup faster and silent
    //  - on Linux, Ozone headless is the real headless path; on macOS it's a
    //    no-op but harmless
    const headless = process.env.GOSSAMER_TEST_HEADLESS === '1';
    let extensionTestsEnv: Record<string, string> | undefined;
    if (headless) {
      console.log('[gossamer-it] headless mode requested');
      launchArgs.push(
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      );
      extensionTestsEnv = {
        ELECTRON_OZONE_PLATFORM_HINT: 'headless',
        // Suppress macOS dock icon flash. Not 100% — Electron grabs focus
        // briefly on launch — but markedly less intrusive.
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      };
    }
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      extensionTestsEnv,
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}
main();
