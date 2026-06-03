// Hardcoded map of common VS Code chords that we forward from inside the
// preview iframe. The iframe is cross-origin to the parent webview, so when
// the user is focused on the previewed page content these chords would
// otherwise be invisible to VS Code's keybinding shim. We intercept them in
// the iframe, postMessage up to the parent, the parent relays to the
// extension host via vscodeApi.postMessage, and we dispatch the matching
// command here.
//
// LIMITATION (documented in README): if the user has customized any of these
// chords in their keybindings.json, the customization will NOT apply inside
// the preview iframe — we always dispatch the default command. This is the
// price of not having access to VS Code's resolved keybindings.

type Chord = {
  key: string;            // lowercase e.key value, e.g. 'p'
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  // Either ctrlKey OR metaKey matches (cross-platform Cmd/Ctrl).
};

type Entry = { chord: Chord; command: string; args?: unknown[] };

const ENTRIES: Entry[] = [
  // Go to File / Quick Open
  { chord: { key: 'p' },                command: 'workbench.action.quickOpen' },
  // Command Palette
  { chord: { key: 'p', shift: true },   command: 'workbench.action.showCommands' },
  // Save
  { chord: { key: 's' },                command: 'workbench.action.files.save' },
  // Close active editor
  { chord: { key: 'w' },                command: 'workbench.action.closeActiveEditor' },
  // Toggle sidebar
  { chord: { key: 'b' },                command: 'workbench.action.toggleSidebarVisibility' },
  // Toggle terminal
  { chord: { key: '`' },                command: 'workbench.action.terminal.toggleTerminal' },
  // Tab navigation
  { chord: { key: 't', shift: true },   command: 'workbench.action.reopenClosedEditor' },
  // Reload window — useful when the user is iterating
  { chord: { key: 'r' },                command: 'workbench.action.reloadWindow' },
];

export interface HostKeyMessage {
  type: string;
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function matches(chord: Chord, msg: HostKeyMessage): boolean {
  const k = (msg.key ?? '').toLowerCase();
  if (k !== chord.key) return false;
  // Either Cmd or Ctrl must be down. Both true is also fine.
  if (!msg.metaKey && !msg.ctrlKey) return false;
  if (!!chord.shift !== !!msg.shiftKey) return false;
  if (!!chord.alt !== !!msg.altKey) return false;
  return true;
}

export function resolveHostKey(msg: HostKeyMessage): Entry | undefined {
  for (const entry of ENTRIES) {
    if (matches(entry.chord, msg)) return entry;
  }
  return undefined;
}

// Dispatch a forwarded host chord. Returns the command name that ran, or
// undefined if no chord matched. Used by both the customEditor and the manual
// preview panel to share identical behavior.
//
// Lazy-require vscode so this module is importable from unit tests (which
// run outside the extension host) without pulling in the vscode types.
export async function dispatchHostKey(msg: HostKeyMessage): Promise<string | undefined> {
  const entry = resolveHostKey(msg);
  if (!entry) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscode = require('vscode');
  await vscode.commands.executeCommand(entry.command, ...(entry.args ?? []));
  return entry.command;
}

// Exposed for tests: enumerate supported chords.
export const __test = {
  entries(): readonly Entry[] { return ENTRIES; },
};
