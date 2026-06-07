#!/usr/bin/env node
/**
 * Fetch the OpenVSX download count for this extension.
 *
 * OpenVSX exposes a public REST API (no auth). The extension metadata
 * endpoint returns `downloadCount`, the cumulative all-time total across
 * every published version:
 *
 *   https://open-vsx.org/api/{namespace}/{extension}
 *
 * Usage:
 *   node scripts/openvsx-downloads.mjs            # print current count
 *   node scripts/openvsx-downloads.mjs --json     # print full JSON summary
 *   node scripts/openvsx-downloads.mjs --record   # append a timestamped row to
 *                                                  # docs/openvsx-downloads.csv
 *
 * The API has no historical/time-series data, so `--record` is how we build
 * up our own history over time (see .github/workflows/openvsx-downloads.yml,
 * which runs this daily).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const NAMESPACE = process.env.OPENVSX_NAMESPACE || 'ashvinbondada';
const EXTENSION = process.env.OPENVSX_EXTENSION || 'gossamer-preview';
const API_URL = `https://open-vsx.org/api/${NAMESPACE}/${EXTENSION}`;
const HISTORY_FILE = path.join(repoRoot, 'docs', 'openvsx-downloads.csv');

async function fetchMetadata() {
  const res = await fetch(API_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OpenVSX API returned ${res.status} ${res.statusText} for ${API_URL}`);
  }
  return res.json();
}

function appendHistory(timestamp, version, downloadCount) {
  const header = 'timestamp,version,downloadCount\n';
  const row = `${timestamp},${version},${downloadCount}\n`;
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, header);
  }
  // Skip if the most recent recorded count is unchanged (avoid noisy no-op commits).
  const existing = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n');
  const lastLine = existing[existing.length - 1];
  if (lastLine && lastLine !== header.trim()) {
    const lastCount = lastLine.split(',')[2];
    if (String(lastCount) === String(downloadCount)) {
      return false;
    }
  }
  fs.appendFileSync(HISTORY_FILE, row);
  return true;
}

async function main() {
  const meta = await fetchMetadata();
  const timestamp = new Date().toISOString();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      namespace: NAMESPACE,
      extension: EXTENSION,
      version: meta.version,
      downloadCount: meta.downloadCount,
      reviewCount: meta.reviewCount,
      timestamp,
    }, null, 2));
  } else {
    console.log(`${NAMESPACE}.${EXTENSION} (v${meta.version}): ${meta.downloadCount} downloads`);
  }

  if (process.argv.includes('--record')) {
    const changed = appendHistory(timestamp, meta.version, meta.downloadCount);
    console.log(changed
      ? `Recorded ${meta.downloadCount} → ${path.relative(repoRoot, HISTORY_FILE)}`
      : `No change since last record (${meta.downloadCount}); nothing appended.`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
