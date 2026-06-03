import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { injectReloadScript } from '../../liveReload';

/**
 * Extract just the <script>...</script> body that injectReloadScript adds,
 * so we can run it in a jsdom that has fake postMessage plumbing.
 */
function extractInjectedScript(): string {
  const sample = injectReloadScript('<body></body>');
  const match = sample.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No script in injected output');
  return match[1];
}

function setup(bodyHtml: string = '<p>Lorem ipsum dolor sit amet</p><p>Another lorem here</p><script>var x = "should not match";</script>') {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:7654/foo.html' });

  const { window } = dom;

  // Stub WebSocket so the injected script's WS connect doesn't blow up in jsdom.
  (window as any).WebSocket = class {
    onmessage: any; onclose: any;
    constructor(_: string) { /* no-op */ }
    close() {}
  };

  // jsdom doesn't implement scrollIntoView — stub it on Element prototype.
  (window as any).Element.prototype.scrollIntoView = function() { /* no-op */ };

  // Capture messages posted to "parent" (= window in the same context here).
  const parentMessages: any[] = [];
  const origPost = window.postMessage.bind(window);
  (window as any).parent = {
    postMessage: (msg: any, _origin: string) => { parentMessages.push(msg); }
  };

  // Eval the injected script in this window.
  const scriptBody = extractInjectedScript();
  window.eval(scriptBody);

  return { window, document: window.document, parentMessages, origPost };
}

function sendToHelper(window: any, data: any) {
  // The helper listens to window 'message' events.
  const ev = new (window as any).MessageEvent('message', { data });
  window.dispatchEvent(ev);
}

describe('injected find helper (jsdom)', () => {

  it('runs a search and highlights matches', () => {
    const { window, document, parentMessages } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    const marks = document.querySelectorAll('mark.__gossamer_hit__');
    assert.strictEqual(marks.length, 2);
    const result = parentMessages.find(m => m.type === 'gossamer-find-result' && m.seq === 1);
    assert.ok(result);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.current, 1);
  });

  it('skips SCRIPT and STYLE content', () => {
    const { window, document } = setup('<p>find me</p><script>find</script><style>find</style>');
    sendToHelper(window, { type: 'gossamer-find', query: 'find', seq: 1 });
    const marks = document.querySelectorAll('mark.__gossamer_hit__');
    assert.strictEqual(marks.length, 1);
  });

  it('marks the first match as active', () => {
    const { window, document } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    const active = document.querySelectorAll('mark.__gossamer_hit_active__');
    assert.strictEqual(active.length, 1);
  });

  it('cleans up marks when given an empty query', () => {
    const { window, document } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 2);
    sendToHelper(window, { type: 'gossamer-find', query: '', seq: 2 });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 0);
  });

  it('responds with 0/0 when no matches', () => {
    const { window, parentMessages } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'zzzzzznotfound', seq: 1 });
    const result = parentMessages.find(m => m.type === 'gossamer-find-result' && m.seq === 1);
    assert.ok(result);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.current, 0);
  });

  it('navigates forward with gossamer-find-nav direction=1', () => {
    const { window, document, parentMessages } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    parentMessages.length = 0;
    sendToHelper(window, { type: 'gossamer-find-nav', direction: 1, seq: 2 });
    const result = parentMessages.find(m => m.type === 'gossamer-find-result');
    assert.ok(result);
    assert.strictEqual(result.current, 2);
    const active = document.querySelectorAll('mark.__gossamer_hit_active__');
    assert.strictEqual(active.length, 1);
  });

  it('navigates backward and wraps around', () => {
    const { window, parentMessages } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    parentMessages.length = 0;
    sendToHelper(window, { type: 'gossamer-find-nav', direction: -1, seq: 2 });
    const result = parentMessages.find(m => m.type === 'gossamer-find-result');
    assert.ok(result);
    // wraps from 1 -> last (total=2)
    assert.strictEqual(result.current, 2);
  });

  it('gossamer-find-clear removes all marks', () => {
    const { window, document } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 1 });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 2);
    sendToHelper(window, { type: 'gossamer-find-clear' });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 0);
  });

  it('drops stale (lower-seq) find requests', () => {
    const { window, document } = setup();
    sendToHelper(window, { type: 'gossamer-find', query: 'lorem', seq: 10 });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 2);
    // stale request with lower seq should be ignored — current matches stay
    sendToHelper(window, { type: 'gossamer-find', query: 'zzznotfound', seq: 5 });
    assert.strictEqual(document.querySelectorAll('mark.__gossamer_hit__').length, 2,
      'stale request should not have cleared matches');
  });

  // The iframe-side keydown listener is in BUBBLE phase only, strict allowlist:
  // forwards Cmd+F/=/+/-/0 to parent. Anything else (Cmd+C, Cmd+V, Cmd+P,
  // Cmd+Shift+P, Cmd+S, Escape, etc.) is untouched — no preventDefault, no forward.

  it('forwards Cmd+F to parent (so Find works from inside the previewed page)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    const fwd = parentMessages.find(m => m.type === 'gossamer-key' && m.key === 'f');
    assert.ok(fwd, 'Cmd+F must be forwarded so the user can Cmd+F over the previewed content');
    assert.strictEqual(ev.defaultPrevented, true, 'Cmd+F should be preventDefault-ed to suppress browser native find');
  });

  it('does NOT forward or preventDefault Cmd+P (must pass through to VS Code)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('does NOT forward or preventDefault Cmd+Shift+P', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('does NOT forward or preventDefault Cmd+C', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('does NOT forward or preventDefault Cmd+V', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('does NOT forward or preventDefault Cmd+S (save)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('does NOT forward Escape (parent handles its own Escape)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });
});
