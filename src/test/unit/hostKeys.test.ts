import * as assert from 'assert';
import { resolveHostKey, __test } from '../../hostKeys';

describe('hostKeys: resolveHostKey()', () => {
  it('Cmd+P → quickOpen', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'p', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.quickOpen');
  });

  it('Ctrl+P (non-mac) → quickOpen', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'p', ctrlKey: true });
    assert.strictEqual(e?.command, 'workbench.action.quickOpen');
  });

  it('Cmd+Shift+P → showCommands', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'P', metaKey: true, shiftKey: true });
    assert.strictEqual(e?.command, 'workbench.action.showCommands');
  });

  it('Cmd+S → save', () => {
    const e = resolveHostKey({ type: 'host-key', key: 's', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.files.save');
  });

  it('Cmd+W → closeActiveEditor', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'w', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.closeActiveEditor');
  });

  it('Cmd+B → toggleSidebarVisibility', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'b', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.toggleSidebarVisibility');
  });

  it('Cmd+` → toggleTerminal', () => {
    const e = resolveHostKey({ type: 'host-key', key: '`', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.terminal.toggleTerminal');
  });

  it('Cmd+R → reloadWindow', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'r', metaKey: true });
    assert.strictEqual(e?.command, 'workbench.action.reloadWindow');
  });

  it('Cmd+Shift+T → reopenClosedEditor', () => {
    const e = resolveHostKey({ type: 'host-key', key: 't', metaKey: true, shiftKey: true });
    assert.strictEqual(e?.command, 'workbench.action.reopenClosedEditor');
  });

  it('plain p (no modifier) → no match', () => {
    assert.strictEqual(resolveHostKey({ type: 'host-key', key: 'p' }), undefined);
  });

  it('Cmd+P + Shift mismatch → does NOT resolve to Cmd+P entry', () => {
    // Cmd+Shift+P is a different chord (showCommands), so this should hit that one
    const e = resolveHostKey({ type: 'host-key', key: 'p', metaKey: true, shiftKey: true });
    assert.strictEqual(e?.command, 'workbench.action.showCommands');
  });

  it('Cmd+P + Alt mismatch → no match (Alt not in any registered chord)', () => {
    const e = resolveHostKey({ type: 'host-key', key: 'p', metaKey: true, altKey: true });
    assert.strictEqual(e, undefined);
  });

  it('unknown key → no match', () => {
    assert.strictEqual(resolveHostKey({ type: 'host-key', key: 'q', metaKey: true }), undefined);
  });

  it('all registered entries have unique chord descriptors', () => {
    const seen = new Set<string>();
    for (const entry of __test.entries()) {
      const sig = JSON.stringify({
        k: entry.chord.key,
        s: !!entry.chord.shift,
        a: !!entry.chord.alt,
      });
      assert.ok(!seen.has(sig), `duplicate chord registration: ${sig} → ${entry.command}`);
      seen.add(sig);
    }
  });
});
