# Plan: Cmd+wheel and trackpad-pinch zoom

Status: planning, not built yet.

## Goal

Two related gestures that feel "like a normal webpage":

1. **Cmd + scroll wheel** → zoom toward the cursor position.
2. **Trackpad pinch (two fingers)** → zoom in/out smoothly.

On Mac, browsers fire `wheel` events with `ctrlKey: true` for trackpad pinches AND for Cmd+wheel. Same code path handles both. (On Windows/Linux, real Ctrl+wheel is the equivalent.)

## Zoom-toward-cursor math

The iframe is scaled with CSS `transform: scale(z)` and the scrollable element is `.frame-wrap` (the parent). The parent has full access to its own scroll position.

Given:
- Cursor at `(cx, cy)` relative to `.frame-wrap` (use `getBoundingClientRect()`).
- Current scroll `(sx, sy)`, current zoom `z0`, new zoom `z1`.

After scaling, to keep the world point under the cursor stationary:

```
sx_new = (sx + cx) * (z1/z0) - cx
sy_new = (sy + cy) * (z1/z0) - cy
```

Apply: set `zoom = z1`, call `applyZoom()`, then assign `wrap.scrollLeft = sx_new` and `wrap.scrollTop = sy_new` in the same frame.

## Jank to watch / mitigate

### 1. Trackpad pinch fires many events per second with tiny `deltaY`

If we map `deltaY → zoom += 0.1 * sign(deltaY)` we get a slot-machine effect.

**Mitigation:** scale the step by `deltaY` magnitude:
```
var step = -e.deltaY * 0.01;        // pinch in → +zoom
var z1 = clamp(zoom + step, 0.25, 4);
```
Browser already throttles wheel events; this gives proportional, smooth zoom.

Fast pinches can still snap to the clamp limits abruptly. Accept that — it matches browser behavior.

### 2. `scrollIntoView({behavior: 'smooth'})` × transform

Find-result `scrollIntoView` runs in the post-transform coordinate space; can look choppy at non-1.0 zoom. Pre-existing issue, wheel zoom exposes it more. Not blocking. Consider switching to `behavior: 'auto'` while zoomed.

### 3. Cursor outside `.frame-wrap`

If the wheel event's `clientX/Y` is over the toolbar or beyond panel edges, the math anchors to a weird point. **Guard:** check `e.target` is inside `wrap` (or compute `(cx, cy)` from `wrap.getBoundingClientRect()` and skip when `cx < 0 || cx > width`).

## Open decisions (need user input before building)

### Decision A: Cmd+wheel over the toolbar — zoom or pass through?

- **Pass through (recommended):** only zoom when wheel target is inside `.frame-wrap` (excluding the toolbar overlay). Cmd-scrolling the toolbar does nothing.
- Alternative: zoom from cursor regardless. Likely surprising.

### Decision B: Pinch-on-content support — iframe-helper wiring required?

The iframe is cross-origin. Wheel events fired over the **page content** (inside the iframe) do NOT bubble to the parent. The parent only sees wheel events over the parent's own chrome.

So:
- **Without** iframe-helper changes: pinch only works when cursor is over the parent (toolbar area / scrollbars). Unintuitive — user expects to pinch over the page.
- **With** iframe-helper changes: the injected helper in `liveReload.ts` listens for `wheel` events with `ctrlKey`, calls `e.preventDefault()` (so the iframe doesn't trigger its own zoom), and `postMessage`s the deltaY + clientX/Y (translated to parent coords) to the parent. Parent applies zoom + scroll adjustment.

Recommend: **do the iframe-helper wiring**. Without it, the feature feels broken.

### Decision C: Zoom step size

- `step = -e.deltaY * 0.01` is a sensible default.
- More aggressive: `0.015`. Snappier but easier to overshoot.
- Less aggressive: `0.005`. More precise, slower.

## Implementation sketch

### `src/previewHtml.ts` — parent

```js
function zoomToward(cx, cy, newZoom) {
  var z0 = zoom;
  var z1 = Math.max(0.25, Math.min(4, newZoom));
  if (z1 === z0) return;
  var rect = wrap.getBoundingClientRect();
  var relX = cx - rect.left;
  var relY = cy - rect.top;
  var sx = wrap.scrollLeft;
  var sy = wrap.scrollTop;
  var ratio = z1 / z0;
  zoom = z1;
  applyZoom();
  wrap.scrollLeft = (sx + relX) * ratio - relX;
  wrap.scrollTop = (sy + relY) * ratio - relY;
}

wrap.addEventListener('wheel', function(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.target.closest('.toolbar')) return; // pass through over toolbar
  e.preventDefault();
  var step = -e.deltaY * 0.01;
  zoomToward(e.clientX, e.clientY, zoom + step);
}, { passive: false });

// Handle forwarded pinch from the iframe
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'gossamer-wheel-zoom') {
    zoomToward(e.data.clientX, e.data.clientY, zoom + e.data.step);
  }
});
```

### `src/liveReload.ts` — injected iframe helper

```js
document.addEventListener('wheel', function(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  // Translate iframe-local clientX/Y → parent coords.
  // The iframe element in the parent is at frame.getBoundingClientRect().
  // From the iframe's perspective, e.clientX is relative to its own viewport.
  // The parent will receive iframe-local coords; parent must add iframe's offset within wrap.
  parent.postMessage({
    type: 'gossamer-wheel-zoom',
    deltaY: e.deltaY,
    step: -e.deltaY * 0.01,
    // Iframe-local coords; parent translates using its known iframe position.
    clientX: e.clientX,
    clientY: e.clientY
  }, '*');
}, { passive: false });
```

### Tricky bit: coordinate translation across the iframe boundary

The iframe-side `clientX/Y` are relative to the iframe's viewport. The parent needs them in the parent's viewport coordinates to compute `relX/relY` against `wrap.getBoundingClientRect()`.

Translation:
```
parent_clientX = iframe_clientX + frame.getBoundingClientRect().left
parent_clientY = iframe_clientY + frame.getBoundingClientRect().top
```

The iframe's bounding rect in the parent already accounts for the CSS `transform: scale()`. So at the moment of receiving the message, the parent reads `frame.getBoundingClientRect()` and adds the offset.

But there's a subtler issue: at non-1.0 zoom, the iframe's content coordinates are scaled. The `clientX/Y` reported by the iframe are in the iframe's content space (unscaled). Need to multiply by the current zoom before adding the iframe offset to get the parent-viewport pixel position.

```
parent_clientX = iframe_clientX * zoom + frame.getBoundingClientRect().left
```

Verify this with a unit test once implementing.

## Tests to add (jsdom)

In `previewPanel.dom.test.ts`:
- `Cmd+wheel inside frame-wrap zooms in and adjusts scroll toward cursor`
- `Cmd+wheel positive deltaY zooms out`
- `Cmd+wheel zooms clamp at 4.0 / 0.25 the same as button clicks`
- `wheel without modifier does nothing`
- `wheel over the toolbar does NOT zoom`
- Receiving `gossamer-wheel-zoom` message applies zoom and scroll

In `liveReload.dom.test.ts`:
- Cmd+wheel inside iframe content emits a `gossamer-wheel-zoom` message with iframe-local coords
- Plain wheel without modifier is NOT forwarded
- Forwarded message includes `step` proportional to deltaY

## Not in scope for this iteration

- Smoothing / animation between zoom levels (would require requestAnimationFrame loop and target/current zoom tracking)
- Zoom inertia
- Touch gestures (mobile webviews — N/A for this product)
