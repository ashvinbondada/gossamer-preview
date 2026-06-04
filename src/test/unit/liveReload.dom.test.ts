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

  // The iframe-side keydown listener forwards three classes:
  //  - Cmd+F/=/+/-/0  → 'gossamer-key' (parent's toolbar handles it)
  //  - Cmd+C/V/X/A/Z/Y → not touched (browser's native selection/clipboard)
  //  - Everything else with a modifier → 'gossamer-host-key' (parent relays to
  //    the extension host so VS Code executes the matching command)

  it('forwards Cmd+F as gossamer-key (toolbar Find)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    const fwd = parentMessages.find(m => m.type === 'gossamer-key' && m.key === 'f');
    assert.ok(fwd, 'Cmd+F must be forwarded so the user can Cmd+F over the previewed content');
    assert.strictEqual(ev.defaultPrevented, true);
  });

  for (const k of ['v', 'a', 'z', 'y']) {
    it(`does NOT touch Cmd+${k.toUpperCase()} (browser-native)`, () => {
      const { window, parentMessages } = setup();
      const ev = new (window as any).KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true });
      window.document.dispatchEvent(ev);
      assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key' || m.type === 'gossamer-host-key'), undefined,
        `Cmd+${k.toUpperCase()} must not be forwarded`);
      assert.strictEqual(ev.defaultPrevented, false,
        `Cmd+${k.toUpperCase()} must not be preventDefault-ed`);
    });
  }

  it('Cmd+C with NO selection is left alone (browser handles whatever it does)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key' || m.type === 'gossamer-host-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('Cmd+C WITH a selection: forwards text to parent as gossamer-clipboard-write', async () => {
    const { window, document, parentMessages } = setup('<p>hello world</p>');
    const p = document.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ev = new (window as any).KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(ev.defaultPrevented, true,
      'Cmd+C with selection MUST preventDefault so VS Code\'s parent-side empty-selection handler does not run');
    const clipMsg = parentMessages.find((m: any) => m && m.type === 'gossamer-clipboard-write');
    assert.ok(clipMsg, `expected gossamer-clipboard-write to be posted to parent, got: ${JSON.stringify(parentMessages)}`);
    assert.ok((clipMsg as any).text.includes('hello world'));
    // Also must NOT be forwarded as host-key.
    assert.strictEqual(parentMessages.find((m: any) => m.type === 'gossamer-host-key'), undefined);
  });

  it('Cmd+X with a selection: forwards text AND deletes selection', async () => {
    const { window, document, parentMessages } = setup('<div contenteditable="true">cut me</div>');
    const d = document.querySelector('div')!;
    const range = document.createRange();
    range.selectNodeContents(d);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ev = new (window as any).KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(ev.defaultPrevented, true);
    const clipMsg = parentMessages.find((m: any) => m && m.type === 'gossamer-clipboard-write');
    assert.ok(clipMsg);
    assert.ok((clipMsg as any).text.includes('cut me'));
  });

  it('forwards Cmd+P as gossamer-host-key (VS Code Quick Open)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    const fwd = parentMessages.find(m => m.type === 'gossamer-host-key' && m.key === 'p');
    assert.ok(fwd, 'Cmd+P must be forwarded to the host for command dispatch');
    assert.strictEqual(fwd.metaKey, true);
    assert.strictEqual(ev.defaultPrevented, true);
  });

  it('forwards Cmd+Shift+P as gossamer-host-key with shiftKey=true', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    const fwd = parentMessages.find(m => m.type === 'gossamer-host-key');
    assert.ok(fwd);
    assert.strictEqual(fwd.shiftKey, true);
    assert.strictEqual(ev.defaultPrevented, true);
  });

  it('forwards Cmd+S as gossamer-host-key', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.ok(parentMessages.find(m => m.type === 'gossamer-host-key' && m.key === 's'));
  });

  it('forwards Cmd+W as gossamer-host-key', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.ok(parentMessages.find(m => m.type === 'gossamer-host-key' && m.key === 'w'));
  });

  it('plain Escape is not forwarded (parent owns Esc handling)', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key' || m.type === 'gossamer-host-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('plain typing (no modifier) is left completely alone', () => {
    const { window, parentMessages } = setup();
    const ev = new (window as any).KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    assert.strictEqual(parentMessages.find(m => m.type === 'gossamer-key' || m.type === 'gossamer-host-key'), undefined);
    assert.strictEqual(ev.defaultPrevented, false);
  });
});
