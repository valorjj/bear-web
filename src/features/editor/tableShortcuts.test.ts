import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';
import { TABLE_SHORTCUT_ACTIONS, tableShortcutChord, tableShortcutHint } from './TableShortcuts';

const TABLE_HTML =
  '<table><tbody>' +
  '<tr><th><p>a</p></th><th><p>b</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
  '</tbody></table>';

const PRISTINE = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n';

/**
 * jsdom reports `navigator.platform` as the empty string, so `isMacOS()` — a
 * `/Mac/` test against it — is FALSE under Vitest and the extension registers
 * the non-mac chords. That is not a quirk to work around: it makes the non-mac
 * branch the one these tests drive by default, and the mac branch reachable
 * only through this override.
 *
 * The override works ONLY because `tableShortcutChord` spells the mac chord
 * `Ctrl-Meta-` rather than `Mod-Ctrl-`. `prosemirror-keymap` resolves `Mod`
 * from its own `navigator.platform` test, evaluated once at MODULE LOAD, which
 * no later override can reach — so a `Mod-` chord would register against the
 * platform the process started on regardless of what this sets.
 */
function setPlatform(value: string): void {
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
}

afterEach(() => setPlatform(''));

function tableEditor(): Editor {
  return new Editor({ extensions: editorExtensions, content: TABLE_HTML });
}

/** Puts the caret inside the table's first body cell. */
function selectInsideTable(editor: Editor): void {
  let pos: number | null = null;
  editor.state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === 'tableCell') pos = at + 2;
    return pos === null;
  });
  expect(pos).not.toBeNull();
  editor.commands.setTextSelection(pos!);
}

/**
 * Runs a real keydown through the view's `handleKeyDown` props, the way the
 * browser does, and reports whether anything claimed it.
 *
 * NOT `editor.commands.keyboardShortcut()`, which every other keymap test in
 * this repo uses and which is WRONG here — measured, not assumed. That command
 * opens an outer Tiptap transaction before invoking the handler, and
 * `prosemirror-tables`' commands build their own transaction from `state.tr`,
 * which on Tiptap's chainable state IS that outer transaction. It gets
 * dispatched by the table command and then again by the command wrapper, and
 * the second application lands a header cell at a position the first already
 * moved: `addColumnAfter` produced a table whose header gained its column at
 * index 1 while the body row gained one at index 2 — a table whose rows no
 * longer line up. It also always returns `true`, even for a chord nothing
 * binds, so it cannot answer "is this bound?" either. This helper reproduces
 * the browser path exactly and gives a real handled/not-handled signal.
 */
function press(editor: Editor, chord: string): boolean {
  const parts = chord.split('-');
  const event = new KeyboardEvent('keydown', {
    key: parts[parts.length - 1],
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Ctrl'),
    metaKey: parts.includes('Meta'),
    shiftKey: parts.includes('Shift'),
    bubbles: true,
    cancelable: true,
  });

  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true;
}

describe('TABLE_SHORTCUT_ACTIONS', () => {
  it('covers the four inserts and none of the deletes', () => {
    expect(TABLE_SHORTCUT_ACTIONS).toEqual([
      'addRowBefore',
      'addRowAfter',
      'addColumnBefore',
      'addColumnAfter',
    ]);
  });
});

describe('tableShortcutChord', () => {
  // Arrow DIRECTION carries the meaning on both platforms — up/down for rows,
  // left/right for columns — so only the modifier differs. It has to: neither
  // pair is free on the other platform. See the function's own docblock.
  it.each([
    ['addRowBefore', 'Ctrl-Meta-ArrowUp', 'Alt-Shift-ArrowUp'],
    ['addRowAfter', 'Ctrl-Meta-ArrowDown', 'Alt-Shift-ArrowDown'],
    ['addColumnBefore', 'Ctrl-Meta-ArrowLeft', 'Alt-Shift-ArrowLeft'],
    ['addColumnAfter', 'Ctrl-Meta-ArrowRight', 'Alt-Shift-ArrowRight'],
  ] as const)('%s is %s on macOS and %s elsewhere', (action, mac, other) => {
    expect(tableShortcutChord(action, true)).toBe(mac);
    expect(tableShortcutChord(action, false)).toBe(other);
  });

  it('spells the mac chord without `Mod`', () => {
    // `Mod` is resolved by `prosemirror-keymap` from a platform test evaluated
    // once at module load, so `Mod-Ctrl-Arrow` registered off mac collapses to
    // a bare `Ctrl-Arrow` — the browser's paragraph navigation, silently
    // claimed. This is what stops that spelling coming back.
    for (const action of TABLE_SHORTCUT_ACTIONS) {
      expect(tableShortcutChord(action, true)).not.toContain('Mod');
      expect(tableShortcutChord(action, false)).not.toContain('Mod');
    }
  });

  it('never gives the two platforms a chord in common', () => {
    const mac = TABLE_SHORTCUT_ACTIONS.map((action) => tableShortcutChord(action, true));
    const other = TABLE_SHORTCUT_ACTIONS.map((action) => tableShortcutChord(action, false));

    expect(mac.some((chord) => other.includes(chord))).toBe(false);
  });
});

describe('tableShortcutHint', () => {
  it.each([
    ['addRowBefore', '⌃⌘↑', 'Alt+Shift+↑'],
    ['addRowAfter', '⌃⌘↓', 'Alt+Shift+↓'],
    ['addColumnBefore', '⌃⌘←', 'Alt+Shift+←'],
    ['addColumnAfter', '⌃⌘→', 'Alt+Shift+→'],
  ] as const)('%s reads %s on macOS and %s elsewhere', (action, mac, other) => {
    expect(tableShortcutHint(action, true)).toBe(mac);
    expect(tableShortcutHint(action, false)).toBe(other);
  });

  it('names the same arrow the chord binds', () => {
    // Hint and keymap come from one table, so a menu can never advertise a key
    // that does nothing. Reading the arrow back out of both is what makes that
    // structural rather than a promise.
    const glyphs: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };

    for (const action of TABLE_SHORTCUT_ACTIONS) {
      const arrow = tableShortcutChord(action, false).replace('Alt-Shift-Arrow', '');
      expect(tableShortcutHint(action, false).endsWith(glyphs[arrow]!)).toBe(true);
      expect(tableShortcutHint(action, true).endsWith(glyphs[arrow]!)).toBe(true);
    }
  });
});

describe('the registered keymap', () => {
  // The expectations are the serializer's own output, padded with a three-dash
  // alignment row per `docs/rulings/tables.md` — not hand-tidied. The caret
  // sits in the FIRST BODY CELL throughout, which is what makes each specific
  // rather than merely "something changed": both column inserts land in the
  // MIDDLE, and each row insert on a named side of the existing body row.
  it.each([
    ['addRowBefore', '| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n\n'],
    ['addRowAfter', '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n\n'],
    ['addColumnBefore', '|     | a   | b   |\n| --- | --- | --- |\n|     | 1   | 2   |\n\n'],
    ['addColumnAfter', '| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n\n'],
  ] as const)('%s changes the document', (action, expected) => {
    const editor = tableEditor();
    selectInsideTable(editor);

    expect(press(editor, tableShortcutChord(action, false))).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(expected);

    editor.destroy();
  });

  it('binds the mac chords on a Mac, and only those', () => {
    setPlatform('MacIntel');
    const editor = tableEditor();
    selectInsideTable(editor);

    // The negative half is what makes this a controlled comparison rather than
    // "something happened": the OTHER platform's chord must be inert here, and
    // the test below asserts the mirror image.
    expect(press(editor, tableShortcutChord('addRowAfter', false))).toBe(false);
    expect(serializeMarkdown(editor.getJSON())).toBe(PRISTINE);

    expect(press(editor, tableShortcutChord('addRowAfter', true))).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n\n',
    );

    editor.destroy();
  });

  it('leaves the mac chords unbound off a Mac', () => {
    const editor = tableEditor();
    selectInsideTable(editor);

    expect(press(editor, tableShortcutChord('addRowAfter', true))).toBe(false);
    expect(serializeMarkdown(editor.getJSON())).toBe(PRISTINE);

    editor.destroy();
  });

  it('does nothing outside a table, so the keystroke falls through', () => {
    const editor = new Editor({ extensions: editorExtensions, content: '<p>plain</p>' });
    editor.commands.setTextSelection(2);

    for (const action of TABLE_SHORTCUT_ACTIONS) {
      expect(press(editor, tableShortcutChord(action, false))).toBe(false);
    }
    expect(serializeMarkdown(editor.getJSON())).toBe('plain');

    editor.destroy();
  });
});
