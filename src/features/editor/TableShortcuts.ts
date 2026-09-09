import { Extension, isMacOS } from '@tiptap/core';

import { COMMANDS } from './tableCommands';

/**
 * The four table actions that get a keyboard chord.
 *
 * A strict subset of `tableCommands.ts`' seven: the three DELETES are
 * deliberately absent. They stay in the right-click menu and the row/column
 * handle menus, where a destructive action is preceded by reading its name —
 * the same reasoning `docs/rulings/tables.md` records for choosing a menu row
 * over a bare `−` button on the handle. A mistyped chord that adds a row is an
 * undo; one that deletes a column the user could not see is data loss.
 */
export const TABLE_SHORTCUT_ACTIONS = [
  'addRowBefore',
  'addRowAfter',
  'addColumnBefore',
  'addColumnAfter',
] as const;

export type TableShortcutAction = (typeof TABLE_SHORTCUT_ACTIONS)[number];

/**
 * The arrow each action answers to, and the glyph a menu shows for it.
 *
 * ONE table feeds both the keymap and the menu hints, so a menu can never
 * advertise a key that does nothing — the failure mode a second hand-written
 * list would eventually produce, silently, since nothing renders a keymap.
 */
const ARROWS: Readonly<Record<TableShortcutAction, { key: string; glyph: string }>> = {
  addRowBefore: { key: 'ArrowUp', glyph: '↑' },
  addRowAfter: { key: 'ArrowDown', glyph: '↓' },
  addColumnBefore: { key: 'ArrowLeft', glyph: '←' },
  addColumnAfter: { key: 'ArrowRight', glyph: '→' },
};

/**
 * The chord for `action` on the given platform.
 *
 * Direction carries the meaning on both — up/down for rows, left/right for
 * columns — and only the modifier differs. It has to: neither modifier pair is
 * free on the other platform.
 *
 * - `Alt-Shift-Arrow` on macOS is extend-selection-by-word, which a table's
 *   cells need as much as any other text.
 * - `Mod-Alt-Arrow` off mac resolves to `Ctrl-Alt-Arrow`, which is already
 *   `HeadingFold`'s section move (up/down) and `StoredImage`'s image resize
 *   (left/right). It is also screen rotation on several Windows graphics
 *   drivers.
 *
 * The mac chord is spelled `Ctrl-Meta-`, NOT `Mod-Ctrl-`. `Mod` is not
 * resolved per call: `prosemirror-keymap` decides it from a `navigator.platform`
 * test evaluated ONCE at module load, so `Mod-Ctrl-ArrowRight` registered off
 * mac collapses to a bare `Ctrl-ArrowRight` — the browser's own paragraph
 * navigation, silently claimed. Writing the modifiers out means the string
 * says the same thing wherever it is read, and it is the only reason a test
 * can reach this branch at all by overriding `navigator.platform`.
 *
 * Verified free against every installed editor package, which
 * `docs/rulings/markdown-and-schema.md` requires rather than suggests:
 *
 *   grep -rEn "Mod-Ctrl|Ctrl-Meta|Alt-Shift|Shift-Alt" node_modules/@tiptap
 *
 * returns nothing.
 */
export function tableShortcutChord(action: TableShortcutAction, mac: boolean): string {
  return `${mac ? 'Ctrl-Meta-' : 'Alt-Shift-'}${ARROWS[action].key}`;
}

/** The same chord, spelled the way a menu shows it beside the action's name. */
export function tableShortcutHint(action: TableShortcutAction, mac: boolean): string {
  return `${mac ? '⌃⌘' : 'Alt+Shift+'}${ARROWS[action].glyph}`;
}

/**
 * Four chords that insert a row or column in the direction of the arrow.
 *
 * An `Extension`, not a `Node` — it registers nothing in the schema, so
 * `computeRecognizedHtmlTags()` and every round-trip suite are blind to it by
 * construction.
 *
 * Only the running platform's four are registered. Both sets at once would
 * mean each platform losing a binding it actually uses, per
 * `tableShortcutChord` above.
 *
 * The handlers run `tableCommands.ts`' `COMMANDS` — `prosemirror-tables`' own
 * commands, the single source of truth this app's context menu and handle
 * menus already share — through `editor.commands.command`, which is the shape
 * `TableHandles`' `runTableHandleAction` proved works here. Each returns the
 * command's own `false` outside a table, so the keystroke falls through to the
 * browser everywhere else in a note.
 */
export const TableShortcuts = Extension.create({
  name: 'tableShortcuts',

  addKeyboardShortcuts() {
    const mac = isMacOS();

    return Object.fromEntries(
      TABLE_SHORTCUT_ACTIONS.map((action) => [
        tableShortcutChord(action, mac),
        () => COMMANDS[action](this.editor.state, this.editor.view.dispatch),
      ]),
    );
  },
});
