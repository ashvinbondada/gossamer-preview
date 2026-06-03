import * as assert from 'assert';
import { buildHtml } from '../../previewHtml';

// Static-structure tests are intentionally minimal: substring assertions only catch
// trivial regressions. Real behavior is covered in previewPanel.dom.test.ts.
describe('buildHtml (preview webview) — static structure', () => {
  const url = 'http://127.0.0.1:7654/foo.html';
  const title = 'foo.html';

  it('iframe is initialized to src="about:blank" with the preview URL exposed as data-base-href', () => {
    const html = buildHtml(url, title);
    assert.ok(html.includes('src="about:blank"'),
      'iframe must start at about:blank — content is hydrated via srcdoc postMessage to avoid the cross-origin HTTP fetch that hangs Cursor webview disposal');
    assert.ok(html.includes(`data-base-href="${url}"`));
  });

  it('escapes title in <title>', () => {
    const html = buildHtml(url, 'a<b>&c"d');
    assert.ok(html.includes('a&lt;b&gt;&amp;c'));
    assert.ok(!html.match(/<title>[^<]*<b>/));
  });

  it('escapes url in iframe src attribute', () => {
    const html = buildHtml('http://x?"\'<>&', title);
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&amp;'));
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
