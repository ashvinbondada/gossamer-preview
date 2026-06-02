import * as assert from 'assert';
import { buildHtml } from '../../previewHtml';

describe('buildHtml (preview webview)', () => {
  const url = 'http://127.0.0.1:7654/foo.html';
  const title = 'foo.html';

  it('includes the preview URL in iframe src', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes(`src="${url}"`));
  });

  it('escapes title in <title>', () => {
    const html = buildHtml(url, 'a<b>&c"d');
    assert.ok(html.includes('a&lt;b&gt;&amp;c'));
    assert.ok(!html.match(/<title>[^<]*<b>/));
  });

  it('escapes url shown in the toolbar', () => {
    const html = buildHtml('http://x?<>&"', title);
    // shown as text node, must be HTML-escaped
    assert.ok(html.includes('&lt;') && html.includes('&gt;') && html.includes('&amp;'));
  });

  it('escapes url in iframe src attribute', () => {
    const html = buildHtml('http://x?"\'<>&', title);
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&amp;'));
  });

  it('declares toolbar with all controls', () => {
    const html = buildHtml(url, title);
    for (const id of ['reload', 'zoomIn', 'zoomOut', 'zoomReset', 'zoomLabel', 'findBtn', 'editSrc']) {
      assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
  });

  it('declares find bar elements', () => {
    const html = buildHtml(url, title);
    for (const id of ['findBar', 'findInput', 'findCount', 'findPrev', 'findNext', 'findClose']) {
      assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
  });

  it('binds Cmd/Ctrl shortcuts in script', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes("e.key === 'f'"));
    assert.ok(html.includes("e.key === '='"));
    assert.ok(html.includes("e.key === '-'"));
    assert.ok(html.includes("e.key === '0'"));
    assert.ok(html.includes('metaKey'));
    assert.ok(html.includes('ctrlKey'));
  });

  it('postMessage editSource when button clicked', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes("postMessage({ type: 'editSource' })"));
  });

  it('clamps zoom between 0.25 and 4', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes('0.25'));
    assert.ok(html.includes(', 4)') || html.includes('Math.min(4'));
  });

  it('uses transform scale for zoom (not browser native)', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes("transform = 'scale("));
  });

  it('find walks text nodes and skips script/style', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes('SHOW_TEXT'));
    assert.ok(html.includes("'SCRIPT'"));
    assert.ok(html.includes("'STYLE'"));
  });

  it('find supports Enter / Shift+Enter navigation', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes("e.key === 'Enter'"));
    assert.ok(html.includes('shiftKey'));
  });

  it('find Esc closes the bar', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes("e.key === 'Escape'"));
  });

  it('uses a per-render nonce for the script tag', () => {
    const a = buildHtml(url, title);
    const b = buildHtml(url, title);
    const re = /<script nonce="([^"]+)">/;
    const na = a.match(re)?.[1];
    const nb = b.match(re)?.[1];
    assert.ok(na && nb);
    assert.notStrictEqual(na, nb, 'nonce should differ between renders');
  });
});
