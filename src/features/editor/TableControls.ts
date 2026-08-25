import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { tablePosAt } from './tablePos';
import { COMMANDS as TABLE_COMMANDS } from './tableCommands';

export { tablePosAt };

/**
 * The five actions the bar offers, in the order it shows them.
 *
 * Adds land AFTER the current row/column rather than offering both directions.
 * Ten buttons on a bar that floats over the user's prose is a worse trade than
 * one extra keystroke, and "after" is the direction a table grows in: `Tab` out
 * of the last cell already appends a row, so this matches a behaviour the
 * editor has always had.
 */
export const TABLE_ACTIONS = [
  'addRow',
  'deleteRow',
  'addColumn',
  'deleteColumn',
  'deleteTable',
] as const;

export type TableAction = (typeof TABLE_ACTIONS)[number];

/**
 * The bar's own five actions, mapped onto `tableCommands.ts`'s seven —
 * `prosemirror-tables`' own commands, not Tiptap's wrappers. The plugin has a
 * `view` and therefore a `state`/`dispatch` pair, but no `Editor` — reaching
 * for one from inside a plugin would be the editor learning about the layer
 * above it, the boundary `TagPill` and `HeadingFold` both keep.
 */
const COMMANDS: Record<
  TableAction,
  (state: EditorState, dispatch?: EditorView['dispatch']) => boolean
> = {
  addRow: TABLE_COMMANDS.addRowAfter,
  deleteRow: TABLE_COMMANDS.deleteRow,
  addColumn: TABLE_COMMANDS.addColumnAfter,
  deleteColumn: TABLE_COMMANDS.deleteColumn,
  deleteTable: TABLE_COMMANDS.deleteTable,
};

export interface TableControlsOptions {
  /**
   * The button labels, keyed by action, plus `toolbar` for the bar's own
   * accessible name. `null` when nobody supplied them — which is the state of
   * the schema-only `editorExtensions` constant — and in that state the bar is
   * NOT rendered at all.
   *
   * Absent rather than unlabelled, deliberately: no user-facing string may be
   * hardcoded in this app, and a bar of five blank buttons would be worse than
   * no bar. Same shape as `HeadingFold`'s `foldHint` and `TagPill`'s
   * `onActivate`, for the same reason.
   */
  labels: (Record<TableAction, string> & { toolbar: string }) | null;
}

export const tableControlsKey = new PluginKey('tableControls');

function barElement(
  view: EditorView,
  labels: NonNullable<TableControlsOptions['labels']>,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bear-table-controls';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', labels.toolbar);
  bar.contentEditable = 'false';

  for (const action of TABLE_ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bear-table-control';
    button.contentEditable = 'false';
    button.setAttribute('data-table-action', action);
    // Words, not glyphs. Three of these five destroy content, and this
    // project's rule is that a destructive control keeps its words — an
    // icon-only "delete column" asks the user to recall a glyph before
    // throwing data away. It also means no new icon path data has to be
    // copied into `Icon.tsx` for a plain-DOM widget to draw.
    button.textContent = labels[action];
    if (action.startsWith('delete')) button.setAttribute('data-destructive', '');
    bar.appendChild(button);
  }

  // `view` is unused today. It is taken because a widget factory receives it
  // and a future disabled-state pass (greying "Delete row" on a one-row
  // table) needs it; naming it here keeps that change to one function.
  void view;
  return bar;
}

/**
 * A floating bar above the table the cursor is in, offering row and column
 * add/delete plus deleting the table.
 *
 * Built as a `Decoration.widget` rather than as React chrome positioned off a
 * rect, for one reason: a widget lives INSIDE the scrolling content, so it
 * tracks the table with no geometry code and cannot drift on scroll. The
 * alternative — `fixed` off `getBoundingClientRect()`, the way `HeadingMenu`
 * is placed — is fine for a menu that closes on the next click, and wrong for
 * chrome that stays up for as long as the caret is in the table.
 *
 * Like `HeadingFold`, this is an `Extension`: it registers nothing in the
 * schema and mutates no document, so every Markdown round-trip test is blind
 * to whether it runs at all. `tableControls.test.ts` asserts on the decoration
 * set and on the commands directly, because nothing else in the suite can see
 * this plugin.
 */
export const TableControls = Extension.create<TableControlsOptions>({
  name: 'tableControls',

  addOptions() {
    return { labels: null };
  },

  addProseMirrorPlugins() {
    const { labels } = this.options;
    if (labels === null) return [];

    return [
      new Plugin({
        key: tableControlsKey,

        props: {
          decorations(state) {
            const pos = tablePosAt(state);
            if (pos === null) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, (view) => barElement(view, labels), {
                // Before the table, so the bar renders above it in flow.
                side: -1,
                // Keyed so the widget is reused across the many transactions
                // that do not move the caret out of this table — without it
                // every keystroke inside a cell rebuilds five buttons.
                key: `table-controls-${pos}`,
                // The bar is chrome, not content: it must never appear in the
                // document ProseMirror serializes, nor absorb a caret.
                ignoreSelection: true,
              }),
            ]);
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const button = target?.closest('[data-table-action]');
              if (!button) return false;

              // Right- and middle-clicks are not activations. Same guard the
              // fold gutter's own handler carries.
              if (event.button !== 0) return false;

              // Stops the caret from being placed into the widget and stops
              // the editor losing focus, so the command below runs against
              // the selection the user could actually see.
              event.preventDefault();

              const action = button.getAttribute('data-table-action') as TableAction | null;
              if (action === null || !(action in COMMANDS)) return false;

              COMMANDS[action](view.state, view.dispatch);
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});
