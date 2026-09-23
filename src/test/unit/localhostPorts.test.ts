import * as assert from 'assert';
import { DEFAULT_LOCALHOST_PORTS } from '../../localhostPortsDefaults';

describe('localhostPorts defaults', () => {
  it('contains the brief\'s repro port (7655)', () => {
    assert.ok(DEFAULT_LOCALHOST_PORTS.includes(7655),
      'port 7655 is the canonical study-session helper port; do not remove without an alternative path');
  });

  it('contains our own live-reload server port (7654)', () => {
    assert.ok(DEFAULT_LOCALHOST_PORTS.includes(7654),
      '7654 is the live-reload server the iframe\'s <base href> points at — removing it would break asset loads');
  });

  it('contains common dev-server ports', () => {
    for (const p of [3000, 5173, 8000, 8080]) {
      assert.ok(DEFAULT_LOCALHOST_PORTS.includes(p), `expected default to include port ${p}`);
    }
  });

  it('has no duplicate ports', () => {
    const seen = new Set(DEFAULT_LOCALHOST_PORTS);
    assert.strictEqual(seen.size, DEFAULT_LOCALHOST_PORTS.length);
  });

  it('all entries are valid TCP port numbers', () => {
    for (const p of DEFAULT_LOCALHOST_PORTS) {
      assert.ok(Number.isInteger(p) && p >= 1 && p <= 65535, `invalid port: ${p}`);
    }
  });
});
