import * as assert from 'assert';
import { escapeHtml, escapeAttr } from '../../previewHtml';

describe('previewHtml escapers', () => {
  it('escapeHtml handles all three chars', () => {
    assert.strictEqual(escapeHtml('<a>&b'), '&lt;a&gt;&amp;b');
  });
  it('escapeAttr escapes quotes', () => {
    assert.strictEqual(escapeAttr('hi "you"'), 'hi &quot;you&quot;');
  });
});
