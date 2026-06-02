import * as path from 'path';
import * as Mocha from 'mocha';
import glob = require('glob');

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 30000 });
  const testsRoot = __dirname;
  return new Promise((resolve, reject) => {
    glob('**/*.test.js', { cwd: testsRoot }, (err, files) => {
      if (err) { reject(err); return; }
      files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));
      try {
        mocha.run((failures) => {
          if (failures > 0) reject(new Error(`${failures} tests failed`));
          else resolve();
        });
      } catch (e) { reject(e); }
    });
  });
}
