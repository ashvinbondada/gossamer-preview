import * as assert from 'assert';
import { buildDiffHtml, escapeHtml, escapeAttr } from '../../diffHtml';

describe('escapeHtml', () => {
  it('escapes <, >, &', () => {
    assert.strictEqual(escapeHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
  });
  it('escapes & first to avoid double-encoding', () => {
    assert.strictEqual(escapeHtml('&lt;'), '&amp;lt;');
  });
  it('leaves safe text alone', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });
});

describe('escapeAttr', () => {
  it('escapes & and "', () => {
    assert.strictEqual(escapeAttr('a"b&c'), 'a&quot;b&amp;c');
  });
  it('preserves < and > (attr context)', () => {
    assert.strictEqual(escapeAttr('<x>'), '<x>');
  });
});

describe('buildDiffHtml', () => {
  it('includes both labels (escaped)', () => {
    const out = buildDiffHtml('<body></body>', '<body></body>', 'a<x>.html', 'b&y.html');
    assert.ok(out.includes('a&lt;x&gt;.html'));
    assert.ok(out.includes('b&amp;y.html'));
  });

  it('renders both iframes with srcdoc', () => {
    const out = buildDiffHtml('<body>A</body>', '<body>B</body>', 'a', 'b');
    assert.ok(out.includes('id="frameA"'));
    assert.ok(out.includes('id="frameB"'));
    assert.ok(out.includes('srcdoc='));
  });

  it('escapes quotes in srcdoc content', () => {
    const out = buildDiffHtml('<body class="x">A"B</body>', '', 'a', 'b');
    // srcdoc must use &quot;
    const match = out.match(/id="frameA" srcdoc="([^"]+)"/);
    assert.ok(match, 'frameA srcdoc not found in expected form');
    assert.ok(match![1].includes('&quot;'), 'inner quotes not escaped in srcdoc');
  });

  it('sandboxes iframes with allow-scripts allow-same-origin', () => {
    const out = buildDiffHtml('', '', 'a', 'b');
    assert.ok(out.includes('sandbox="allow-scripts allow-same-origin"'));
  });

  it('synchronizes scroll between frames', () => {
    const out = buildDiffHtml('', '', 'a', 'b');
    assert.ok(out.includes('syncScroll'));
    assert.ok(out.includes("addEventListener('scroll'"));
  });

  it('marks size/position diffs with outlines', () => {
    const out = buildDiffHtml('', '', 'a', 'b');
    assert.ok(out.includes('getBoundingClientRect'));
    assert.ok(out.includes('255,80,80'));
    assert.ok(out.includes('80,180,255'));
  });
});
