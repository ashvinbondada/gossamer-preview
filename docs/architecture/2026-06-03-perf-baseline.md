# Perf baseline — 2026-06-03

Measured with `scripts/perf-iframe.mjs` (Playwright + chromium, 10 runs, median).

Target file: `gossamer-testing/THESIS.html` (6.3 KB inline HTML, no external assets).

## Iframe-side timings (post-A/B/C changes)

| Field                  | Median (ms) | Min   | Max   |
|------------------------|-------------|-------|-------|
| ttfb                   |       0.4   |  0.2  |  2.2  |
| responseEnd            |       1.1   |  1.0  |  3.5  |
| domInteractive         |       4.2   |  3.8  |  6.6  |
| domContentLoaded       |       4.2   |  3.8  |  6.6  |
| domComplete            |       4.5   |  4.2  |  7.0  |
| loadEvent              |       4.6   |  4.2  |  7.0  |
| wallClock              |       5.0   |  5.0  |  8.0  |

transferSize: 12,432 bytes (THESIS.html + injected reload+find helper).

## Interpretation

The iframe content load is **~5 ms total in a real Chromium browser**.

The user-reported "one Mississippi" wait (~1000 ms) is therefore **not** the iframe
load — it is the VS Code webview cold-start (process spawn, IPC, initial HTML
render). That portion is outside the iframe measurement boundary and largely
outside our control.

## What was changed in this session (A/B/C)

- **A** — `src/perf.ts` adds an opt-in extension-host perf scope. Gated by a
  hard-coded `PERF_HOST_ENABLED = false`. Flip locally to see extension-side
  timings in the "Gossamer Preview Perf" output channel.
- **B** — dropped `backdrop-filter: blur(...) saturate(...)` from `.toolbar`
  and `.history` (was forcing per-frame readback and compositor work in the
  webview). Replaced with a slightly more opaque solid background. Also added
  a guard so `applyZoom()` does not write an inline `transform` while zoom=1.
- **C** — added a CSS skeleton overlay (`.skeleton` + `.skel-line` shimmer)
  that paints inside `.frame-wrap` immediately and fades out + is removed
  from the DOM when the iframe `load` event fires. No JS gating on first
  paint — it appears as soon as the webview parses our HTML.

## What was NOT done

- **No backend asset serving.** The user previews self-contained AI artifacts;
  no perf hit from 404s on external assets.
- **No panel pool / lazy webview pre-warming.** Would help cold-start but
  requires non-trivial extension wiring and ongoing memory cost.

## How to run

```bash
npm run compile
node scripts/perf-iframe.mjs                    # default: THESIS.html
node scripts/perf-iframe.mjs path/to/other.html # any file
```

To compare a change, capture baseline first, then re-run after the change and
diff the medians.
