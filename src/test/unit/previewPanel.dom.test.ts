import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { buildToolbarMarkup, buildPreviewScript, PREVIEW_STYLES } from '../../previewHtml';

/**
 * Spin up a jsdom with the toolbar markup and the real preview script attached.
 * Returns the window, document, and helpers for sending fake messages to the parent.
 */
function setup(title: string = 'foo.html', copyPath?: string) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><style>${PREVIEW_STYLES}</style></head>
<body>${buildToolbarMarkup('http://127.0.0.1:7654/foo.html', title)}
<script>${buildPreviewScript(title, copyPath)}</script>
</body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true });

  const { window } = dom;
  const { document } = window;
  return { dom, window, document };
}

function key(window: any, target: any, opts: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) {
  const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(ev);
  return ev;
}

function type(window: any, input: any, value: string) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

// Quick fake clipboard so we can assert the copy button actually wrote something.
function installClipboardMock(window: any) {
  const calls: string[] = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (s: string) => { calls.push(s); return Promise.resolve(); } }
  });
  return calls;
}

describe('preview script — toolbar & find behavior (jsdom)', () => {

  it('toolbar starts closed (no .open class)', () => {
    const { document } = setup();
    assert.ok(!document.getElementById('toolbar')!.classList.contains('open'));
  });

  it('clicking findBtn opens the toolbar', () => {
    const { document } = setup();
    document.getElementById('findBtn')!.dispatchEvent(new (document.defaultView as any).Event('click', { bubbles: true }));
    assert.ok(document.getElementById('toolbar')!.classList.contains('open'));
  });

  it('clicking findBtn while open closes the toolbar', () => {
    const { document } = setup();
    const btn = document.getElementById('findBtn')!;
    btn.dispatchEvent(new (document.defaultView as any).Event('click', { bubbles: true }));
    btn.dispatchEvent(new (document.defaultView as any).Event('click', { bubbles: true }));
    assert.ok(!document.getElementById('toolbar')!.classList.contains('open'));
  });

  it('Cmd+F opens find', () => {
    const { window, document } = setup();
    key(window, document, { key: 'f', metaKey: true });
    assert.ok(document.getElementById('toolbar')!.classList.contains('open'));
  });

  it('Ctrl+F also opens find (non-mac users)', () => {
    const { window, document } = setup();
    key(window, document, { key: 'f', ctrlKey: true });
    assert.ok(document.getElementById('toolbar')!.classList.contains('open'));
  });

  it('Cmd+P is NOT intercepted (must pass through to VS Code)', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 'p', metaKey: true });
    assert.strictEqual(ev.defaultPrevented, false,
      'Cmd+P must not be preventDefault-ed by the webview handler');
  });

  it('Cmd+Shift+P is NOT intercepted (must pass through to VS Code)', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 'P', metaKey: true, shiftKey: true });
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('Cmd+C is NOT intercepted', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 'c', metaKey: true });
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('Cmd+V is NOT intercepted', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 'v', metaKey: true });
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('Cmd+S is NOT intercepted (save shortcut must pass through)', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 's', metaKey: true });
    assert.strictEqual(ev.defaultPrevented, false);
  });

  it('plain Escape (toolbar closed) is NOT intercepted', () => {
    const { window, document } = setup();
    const ev = key(window, document, { key: 'Escape' });
    assert.strictEqual(ev.defaultPrevented, false);
  });

  describe('two-stage Esc', () => {
    it('Esc with empty input closes immediately', () => {
      const { window, document } = setup();
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      assert.strictEqual(input.value, '');
      key(window, input, { key: 'Escape' });
      assert.ok(!document.getElementById('toolbar')!.classList.contains('open'));
    });

    it('Esc with non-empty input clears the input but keeps toolbar open', () => {
      const { window, document } = setup();
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'hello');
      assert.strictEqual(input.value, 'hello');
      key(window, input, { key: 'Escape' });
      assert.strictEqual(input.value, '');
      assert.ok(document.getElementById('toolbar')!.classList.contains('open'),
        'toolbar should still be open after first Esc');
    });

    it('Esc twice (with text) clears then closes', () => {
      const { window, document } = setup();
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'hello');
      key(window, input, { key: 'Escape' });
      key(window, input, { key: 'Escape' });
      assert.ok(!document.getElementById('toolbar')!.classList.contains('open'));
    });
  });

  describe('copy path', () => {
    it('clicking copy button writes filename to clipboard when no copyPath given', async () => {
      const { window, document } = setup('myfile.html');
      const calls = installClipboardMock(window);
      document.getElementById('copyFile')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
      assert.deepStrictEqual(calls, ['myfile.html']);
    });

    it('clicking copy button writes the relative path when copyPath is provided', async () => {
      const { window, document } = setup('myfile.html', 'src/pages/myfile.html');
      const calls = installClipboardMock(window);
      document.getElementById('copyFile')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
      assert.deepStrictEqual(calls, ['src/pages/myfile.html']);
    });

    it('toolbar label stays as the short filename even when copyPath is a long path', () => {
      const { document } = setup('myfile.html', 'src/a/b/c/d/myfile.html');
      assert.strictEqual(document.getElementById('copyLabel')!.textContent, 'myfile.html');
    });

    it('copy button shows "Copied" feedback', async () => {
      const { window, document } = setup('myfile.html', 'src/myfile.html');
      installClipboardMock(window);
      const label = document.getElementById('copyLabel')!;
      assert.strictEqual(label.textContent, 'myfile.html');
      document.getElementById('copyFile')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
      assert.strictEqual(label.textContent, 'Copied');
    });
  });

  describe('history dropdown', () => {
    function openFindAndAdvanceTimers(window: any, document: any) {
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      // history is shown inside a setTimeout(...80) after openFind
      return new Promise(r => setTimeout(r, 100));
    }

    it('initial history shows "No searches yet" empty state', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const history = document.getElementById('history')!;
      assert.ok(history.classList.contains('visible'));
      assert.ok(history.textContent!.includes('No searches yet'));
    });

    it('typing hides the history dropdown', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      type(window, input, 'h');
      assert.ok(!document.getElementById('history')!.classList.contains('visible'));
    });

    it('clearing input (Esc once) re-shows the history dropdown', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      type(window, input, 'hello');
      key(window, input, { key: 'Escape' });
      assert.ok(document.getElementById('history')!.classList.contains('visible'));
    });

    it('closing find with text pushes that query onto history', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      type(window, input, 'foo');
      // close via the X button
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      // re-open
      await openFindAndAdvanceTimers(window, document);
      const history = document.getElementById('history')!;
      assert.ok(history.textContent!.includes('foo'), 'history should contain previously-searched "foo"');
    });

    it('history dedupes — re-searching the same query keeps one entry', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;

      type(window, input, 'foo');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);
      type(window, input, 'foo');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);

      const items = document.querySelectorAll('#historyList .history-item');
      assert.strictEqual(items.length, 1);
    });

    it('ArrowDown selects first history item', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      // seed two entries
      type(window, input, 'foo');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);
      type(window, input, 'bar');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);

      key(window, input, { key: 'ArrowDown' });
      const items = document.querySelectorAll('#historyList .history-item');
      assert.ok((items[0] as any).classList.contains('active'));
    });

    it('ArrowDown then Enter applies selected history item to input', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      type(window, input, 'pickme');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);

      key(window, input, { key: 'ArrowDown' });
      key(window, input, { key: 'Enter' });
      assert.strictEqual(input.value, 'pickme');
    });

    it('clicking history-clear empties the list', async () => {
      const { window, document } = setup();
      await openFindAndAdvanceTimers(window, document);
      const input = document.getElementById('findInput') as any;
      type(window, input, 'foo');
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      await openFindAndAdvanceTimers(window, document);

      document.getElementById('historyClear')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const items = document.querySelectorAll('#historyList .history-item');
      assert.strictEqual(items.length, 0);
      assert.ok(document.querySelector('#historyList .history-empty'));
    });
  });

  describe('find result counter', () => {
    it('updates from gossamer-find-result postMessage', async () => {
      const { window, document } = setup();
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'lorem');
      // simulate iframe replying with a result
      window.postMessage({ type: 'gossamer-find-result', seq: 999, total: 5, current: 1 }, '*');
      await new Promise(r => setTimeout(r, 0));
      assert.strictEqual(document.getElementById('findCount')!.textContent, '1 / 5');
    });

    it('ignores stale result messages with old seq', async () => {
      const { window, document } = setup();
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'lorem');
      // Establish a known count first (seq=999 is guaranteed > anything sendFind produced).
      window.postMessage({ type: 'gossamer-find-result', seq: 999, total: 5, current: 1 }, '*');
      await new Promise(r => setTimeout(r, 0));
      assert.strictEqual(document.getElementById('findCount')!.textContent, '1 / 5');
      // Now send a strictly-older seq — it must be dropped, count unchanged.
      window.postMessage({ type: 'gossamer-find-result', seq: 1, total: 999, current: 999 }, '*');
      await new Promise(r => setTimeout(r, 0));
      assert.strictEqual(document.getElementById('findCount')!.textContent, '1 / 5');
    });
  });

  describe('zoom', () => {
    it('Cmd+= increases zoom by 10%', () => {
      const { window, document } = setup();
      key(window, document, { key: '=', metaKey: true });
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '110%');
    });

    it('Cmd+- decreases zoom by 10%', () => {
      const { window, document } = setup();
      key(window, document, { key: '-', metaKey: true });
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '90%');
    });

    it('Cmd+0 resets zoom to 100%', () => {
      const { window, document } = setup();
      key(window, document, { key: '=', metaKey: true });
      key(window, document, { key: '=', metaKey: true });
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '120%');
      key(window, document, { key: '0', metaKey: true });
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '100%');
    });

    it('zoomIn button applies CSS transform: scale(...) to iframe', () => {
      const { window, document } = setup();
      document.getElementById('zoomIn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const frame = document.getElementById('frame') as any;
      assert.ok(frame.style.transform.startsWith('scale('),
        `expected transform to start with scale(, got: ${frame.style.transform}`);
    });

    it('zoom clamps at 0.25 (25%) on repeated zoom-out', () => {
      const { window, document } = setup();
      // Default 1.0 → step 0.1 → would go negative after 10+ clicks. Click 20 times.
      for (let i = 0; i < 20; i++) {
        document.getElementById('zoomOut')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      }
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '25%');
      const frame = document.getElementById('frame') as any;
      assert.ok(/scale\(0\.25\)/.test(frame.style.transform),
        `expected scale(0.25), got: ${frame.style.transform}`);
    });

    it('zoom clamps at 4.0 (400%) on repeated zoom-in', () => {
      const { window, document } = setup();
      for (let i = 0; i < 40; i++) {
        document.getElementById('zoomIn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      }
      assert.strictEqual(document.getElementById('zoomLabel')!.textContent, '400%');
    });
  });

  describe('edit source', () => {
    function setupWithVsCodeApi(title: string = 'foo.html') {
      const calls: any[] = [];
      // Inject acquireVsCodeApi BEFORE the preview script evaluates.
      const dom = new JSDOM(`<!DOCTYPE html><html><head><style>${PREVIEW_STYLES}</style></head>
<body>${buildToolbarMarkup('http://127.0.0.1:7654/foo.html', title)}
<script>
window.acquireVsCodeApi = function() { return { postMessage: function(m) { window.__vscodeCalls.push(m); } }; };
window.__vscodeCalls = [];
</script>
<script>${buildPreviewScript(title)}</script>
</body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true });
      return { window: dom.window, document: dom.window.document, calls: (dom.window as any).__vscodeCalls };
    }

    it('clicking Edit Source posts an editSource message to the extension', () => {
      const { window, document, calls } = setupWithVsCodeApi();
      document.getElementById('editSrc')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const msg = calls.find((m: any) => m && m.type === 'editSource');
      assert.ok(msg, 'expected an editSource postMessage to be captured');
    });

    it('editSourceState message toggles the active class on Edit button', () => {
      const { window, document } = setupWithVsCodeApi();
      const btn = document.getElementById('editSrc')!;
      assert.ok(!btn.classList.contains('active'));
      window.postMessage({ type: 'editSourceState', open: true }, '*');
      // postMessage is async in jsdom — wait a tick
      return new Promise<void>(resolve => setTimeout(() => {
        assert.ok(btn.classList.contains('active'));
        assert.strictEqual(btn.getAttribute('title'), 'Close HTML source');
        resolve();
      }, 0));
    });
  });

  describe('toolbar wake sweep animation', () => {
    const WAKE_SWEEP_MS = 750;

    it('does NOT add .waking class on initial page load', () => {
      const { document } = setup();
      const toolbar = document.getElementById('toolbar')!;
      assert.ok(!toolbar.classList.contains('waking'),
        'toolbar should not have .waking class right after initial paint');
    });

    it('adds .waking class when mousemove fires on .frame-wrap after toolbar dimmed', () => {
      const { window, document } = setup();
      const toolbar = document.getElementById('toolbar')!;
      // Simulate the idle state: page-load bump already ran, now force dimmed.
      toolbar.classList.add('dimmed');
      assert.ok(!toolbar.classList.contains('waking'));
      const wrap = document.getElementById('wrap')!;
      wrap.dispatchEvent(new (window as any).Event('mousemove', { bubbles: true }));
      assert.ok(toolbar.classList.contains('waking'),
        'toolbar should have .waking class after dimmed→active transition');
      assert.ok(!toolbar.classList.contains('dimmed'),
        '.dimmed should be cleared by the wake');
    });

    it('removes .waking class after the sweep duration elapses', async () => {
      const { window, document } = setup();
      const toolbar = document.getElementById('toolbar')!;
      toolbar.classList.add('dimmed');
      const wrap = document.getElementById('wrap')!;
      wrap.dispatchEvent(new (window as any).Event('mousemove', { bubbles: true }));
      assert.ok(toolbar.classList.contains('waking'));
      await new Promise(r => setTimeout(r, WAKE_SWEEP_MS + 50));
      assert.ok(!toolbar.classList.contains('waking'),
        '.waking should be removed after the sweep duration');
    });
  });

  describe('gossamer-find postMessage emission', () => {
    // Capture messages sent to the iframe's contentWindow.
    function captureFrameMessages(window: any, document: any) {
      const captured: any[] = [];
      const frame = document.getElementById('frame');
      // jsdom gives us a real contentWindow; replace its postMessage with a spy.
      Object.defineProperty(frame, 'contentWindow', {
        configurable: true,
        value: { postMessage: (msg: any, _origin: string) => { captured.push(msg); } }
      });
      return captured;
    }

    it('typing into find input emits a gossamer-find message to the iframe', () => {
      const { window, document } = setup();
      const captured = captureFrameMessages(window, document);
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'hello');
      const findMsg = captured.find((m: any) => m && m.type === 'gossamer-find' && m.query === 'hello');
      assert.ok(findMsg, `expected gossamer-find with query "hello", got: ${JSON.stringify(captured)}`);
      assert.strictEqual(typeof findMsg.seq, 'number');
    });

    it('clicking findNext emits gossamer-find-nav with direction 1', () => {
      const { window, document } = setup();
      const captured = captureFrameMessages(window, document);
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      document.getElementById('findNext')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const navMsg = captured.find((m: any) => m && m.type === 'gossamer-find-nav');
      assert.ok(navMsg);
      assert.strictEqual(navMsg.direction, 1);
    });

    it('clicking findPrev emits gossamer-find-nav with direction -1', () => {
      const { window, document } = setup();
      const captured = captureFrameMessages(window, document);
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      document.getElementById('findPrev')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const navMsg = captured.find((m: any) => m && m.type === 'gossamer-find-nav');
      assert.ok(navMsg);
      assert.strictEqual(navMsg.direction, -1);
    });

    it('closing find emits gossamer-find-clear to the iframe', () => {
      const { window, document } = setup();
      const captured = captureFrameMessages(window, document);
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'x');
      captured.length = 0;
      document.getElementById('findClose')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      assert.ok(captured.find((m: any) => m && m.type === 'gossamer-find-clear'),
        `expected gossamer-find-clear, got: ${JSON.stringify(captured)}`);
    });

    it('seq increments monotonically across successive find requests', () => {
      const { window, document } = setup();
      const captured = captureFrameMessages(window, document);
      document.getElementById('findBtn')!.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
      const input = document.getElementById('findInput') as any;
      type(window, input, 'a');
      type(window, input, 'ab');
      type(window, input, 'abc');
      const finds = captured.filter((m: any) => m && m.type === 'gossamer-find');
      assert.ok(finds.length >= 3, `expected >=3 find messages, got ${finds.length}`);
      for (let i = 1; i < finds.length; i++) {
        assert.ok(finds[i].seq > finds[i - 1].seq,
          `seq must increase: got ${finds[i - 1].seq} then ${finds[i].seq}`);
      }
    });
  });
});
