import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');
    const workspace = path.resolve(__dirname, '../../../src/test/fixtures');
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, '--disable-extensions'],
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}
main();
