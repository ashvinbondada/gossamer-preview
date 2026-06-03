#!/usr/bin/env node
/**
 * Standalone perf measurement for the iframe-side cost.
 *
 * Boots the LiveReloadServer, points Playwright at a test HTML file (THESIS.html),
 * navigates fresh, and reports navigation/paint timings. Run before and after a
 * change to verify perf moved in the right direction.
 *
 * Usage:
 *   node scripts/perf-iframe.mjs [path/to/file.html]
 *
 * Output: JSON with median timings over N runs.
 *
 * Note: this measures the iframe content load (HTTP request → DOMContentLoaded →
 * load → first paint), NOT the VS Code webview cold-start. The webview cold-start
 * is structurally outside our measurement boundary.
 */
import { chromium } from 'playwright';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targetFile = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repoRoot, 'gossamer-testing', 'THESIS.html');

const RUNS = 10;

async function main() {
  // Compile so we have out/liveReload.js
  // (assumes you've run `npm run compile` already)
  const { LiveReloadServer } = await import(path.join(repoRoot, 'out', 'liveReload.js'));

  const server = new LiveReloadServer();
  await server.start();
  const urlPath = server.setFile(targetFile);
  const fullUrl = `http://127.0.0.1:${server.port}${urlPath}`;

  console.log(`[perf-iframe] target: ${targetFile}`);
  console.log(`[perf-iframe] url:    ${fullUrl}`);
  console.log(`[perf-iframe] runs:   ${RUNS}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const navStart = Date.now();
    const response = await page.goto(fullUrl, { waitUntil: 'load' });
    const loadEnd = Date.now();
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      const fp = paints.find((p) => p.name === 'first-paint');
      const fcp = paints.find((p) => p.name === 'first-contentful-paint');
      return {
        ttfb: nav.responseStart - nav.requestStart,
        responseEnd: nav.responseEnd,
        domInteractive: nav.domInteractive,
        domContentLoaded: nav.domContentLoadedEventEnd,
        domComplete: nav.domComplete,
        loadEvent: nav.loadEventEnd,
        firstPaint: fp ? fp.startTime : null,
        firstContentfulPaint: fcp ? fcp.startTime : null,
        responseStatus: null,
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
      };
    });
    timing.responseStatus = response.status();
    timing.wallClock = loadEnd - navStart;
    results.push(timing);
    await context.close();
  }
  await browser.close();
  server.dispose();

  const median = (xs) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const fields = [
    'ttfb', 'responseEnd', 'domInteractive', 'domContentLoaded',
    'domComplete', 'loadEvent', 'firstPaint', 'firstContentfulPaint', 'wallClock',
  ];
  const summary = {};
  for (const f of fields) {
    const vals = results.map((r) => r[f]).filter((v) => v != null);
    if (vals.length === 0) { summary[f] = null; continue; }
    summary[f] = {
      median: Number(median(vals).toFixed(2)),
      min: Number(Math.min(...vals).toFixed(2)),
      max: Number(Math.max(...vals).toFixed(2)),
    };
  }
  summary.runs = RUNS;
  summary.transferSize = results[0].transferSize;
  summary.encodedBodySize = results[0].encodedBodySize;
  console.log('[perf-iframe] median timings (ms):\n');
  for (const f of fields) {
    if (!summary[f]) continue;
    const { median, min, max } = summary[f];
    console.log(`  ${f.padEnd(24)} median=${String(median).padStart(7)}  min=${String(min).padStart(7)}  max=${String(max).padStart(7)}`);
  }
  console.log(`\n  transferSize: ${summary.transferSize} bytes  encodedBodySize: ${summary.encodedBodySize} bytes`);
  console.log('\n[perf-iframe] JSON:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
