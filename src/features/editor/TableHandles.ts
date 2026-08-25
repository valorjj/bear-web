import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { renderIconMarkup, Plus } from '@/ui/Icon';

import { tablePosAt } from './tablePos';
import { COMMANDS } from './tableCommands';

export interface TableHandlesOptions {
  /**
   * The two handle labels — one for the row edge, one for the column edge.
   * `null` when nobody supplied them, which is the state of the schema-only
   * `editorExtensions` constant, and in that state no plugin is registered at
   * all and no handle is drawn.
   *
   * Absent rather than unlabelled, deliberately: no user-facing string may be
   * hardcoded in this app, and an icon-only button with no accessible name is
   * invisible to a screen reader. Same shape as `HeadingFold`'s `foldHint`
   * and `TagPill`'s `onActivate`, for the same reason.
   */
  labels: { addRow: string; addColumn: string } | null;
}

export const tableHandlesKey = new PluginKey('tableHandles');

/**
 * The gap, in CSS pixels, between the table's LEFT edge and a row handle.
 *
 * Rows only. A column handle straddles the table's top border instead of
 * sitting above it: the editor's prose runs right up to the table, so a
 * handle placed fully above one overlapped the preceding heading — visible
 * only in a screenshot, which is why this number was set from one rather than
 * chosen. There is no prose to the LEFT of a table, only the pane's own
 * padding, so a row handle has room to sit outside.
 */
const ROW_GAP = 4;

type HandleKind = 'row' | 'column';

/**
 * The document position of the first text position inside cell (`row`,
 * `column`) of the table node at `tablePos`, or `null` if there is no such
 * cell.
 *
 * This is the whole reason `TableHandles` is more than a restyled bar. The bar
 * acted on wherever the caret already was, so it never needed to name a cell.
 * A handle names a SPECIFIC row or column, which is almost never the caret's —
 * so the target has to be resolved from the measured index and the selection
 * moved into it before `prosemirror-tables`' command runs, because those
 * commands read the selection and nothing else.
 *
 * Walks the node tree rather than the DOM: the DOM is what was measured, but
 * the command needs a document position, and the two are only kept in step by
 * the row/column INDEX. Row order in the node matches `<tr>` order in the
 * rendered table, which is what makes the index a valid bridge.
 */
export function cellTextPos(
  doc: ProseMirrorNode,
  tablePos: number,
  row: number,
  column: number,
): number | null {
  const table = doc.nodeAt(tablePos);
  if (table === null || table.type.name !== 'table') return null;
  if (row < 0 || row >= table.childCount) return null;

  // +1 steps past the table node's own opening token, into its content.
  let at = tablePos + 1;
  for (let r = 0; r < row; r += 1) at += table.child(r).nodeSize;

  const rowNode = table.child(row);
  if (column < 0 || column >= rowNode.childCount) return null;

  // +1 again, past the row node's opening token.
  let cellAt = at + 1;
  for (let c = 0; c < column; c += 1) cellAt += rowNode.child(c).nodeSize;

  // +1 once more, past the cell's own opening token, so the position lands
  // inside the cell rather than before it. `TextSelection.near` then finds the
  // nearest real text position inside the cell's paragraph.
  return cellAt + 1;
}

function handleElement(kind: HandleKind, index: number, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bear-table-handle';
  button.contentEditable = 'false';
  button.setAttribute('data-table-handle', kind);
  button.setAttribute('data-index', String(index));
  // Icon-only, and therefore labelled: unlike the bar this replaces, neither
  // handle destroys anything, so a glyph is honest here where a glyph on
  // "Delete column" would not have been. The words for deletion moved to the
  // context menu.
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.innerHTML = renderIconMarkup(Plus, 'sm');
  return button;
}

/**
 * Finds the `<table>` element for the table node at `pos`.
 *
 * `nodeDOM` may hand back a wrapper rather than the table itself (Tiptap's
 * table extension renders one), so the table is looked for inside whatever
 * comes back. Returns `null` freely: this runs during view updates and the
 * DOM for a just-inserted table is not always there yet, which is exactly why
 * `measure()` is called again from the plugin's `view()` update hook.
 */
function tableElement(view: EditorView, pos: number): HTMLTableElement | null {
  const dom = view.nodeDOM(pos);
  if (dom === null || !(dom instanceof HTMLElement)) return null;
  if (dom instanceof HTMLTableElement) return dom;
  return dom.querySelector('table');
}

/**
 * Builds the overlay layer for the table at `pos` and returns it together with
 * the `measure()` closure that positions its handles.
 *
 * `measure()` is geometry code, and the widget shape was originally chosen
 * (for the bar) precisely so that no geometry code would be needed — see the
 * extension docblock. It reads three kinds of rect: the layer's own (the
 * origin everything is expressed relative to), the table's (which edge to sit
 * against) and each row's / first-row cell's (where along that edge). Nothing
 * is cached between runs, because every input can change without a
 * transaction — a pane resize moves all of them.
 */
function handlesLayer(
  view: EditorView,
  pos: number,
  labels: NonNullable<TableHandlesOptions['labels']>,
): { dom: HTMLElement; measure: () => void } {
  const layer = document.createElement('div');
  layer.className = 'bear-table-handles';
  // Chrome, not content. `contentEditable = 'false'` keeps it out of anything
  // ProseMirror reads back from the DOM; `pointer-events` is re-enabled on the
  // buttons alone, in CSS, so the layer cannot shadow the prose beneath it.
  layer.contentEditable = 'false';

  const measure = (): void => {
    const table = tableElement(view, pos);
    if (table === null) return;

    const rows = Array.from(table.querySelectorAll('tr'));
    const columns = Array.from(rows[0]?.children ?? []).filter(
      (cell): cell is HTMLElement => cell instanceof HTMLElement,
    );

    // Rebuild only when the SHAPE changed. A table is re-measured on every
    // transaction, and rebuilding unconditionally would drop focus from a
    // handle a keyboard user had just tabbed to.
    const wanted = rows.length + columns.length;
    if (layer.childElementCount !== wanted) {
      layer.replaceChildren(
        ...rows.map((_row, index) => handleElement('row', index, labels.addRow)),
        ...columns.map((_cell, index) => handleElement('column', index, labels.addColumn)),
      );
    }

    const origin = layer.getBoundingClientRect();
    const bounds = table.getBoundingClientRect();
    const buttons = Array.from(layer.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );

    rows.forEach((row, index) => {
      const button = buttons[index];
      if (button === undefined) return;
      const rect = row.getBoundingClientRect();
      button.style.left = `${bounds.left - origin.left - ROW_GAP}px`;
      button.style.top = `${rect.top + rect.height / 2 - origin.top}px`;
    });

    columns.forEach((cell, index) => {
      const button = buttons[rows.length + index];
      if (button === undefined) return;
      const rect = cell.getBoundingClientRect();
      button.style.left = `${rect.left + rect.width / 2 - origin.left}px`;
      button.style.top = `${bounds.top - origin.top}px`;
    });
  };

  measure();
  return { dom: layer, measure };
}

/**
 * `⊕` handles on a table's row and column edges, revealed on hover.
 *
 * NOT the bar this replaces, and the difference is the point. The bar was five
 * words floating above the user's prose — a control that named the table
 * rather than pointing at a part of it, and one the user rejected outright
 * ("I do not want a text-written button"). These handles put the control where
 * the thing is: the `⊕` beside row three inserts a row after row three, with
 * no reading and no aiming at a shared bar.
 *
 * The bar was built as a `Decoration.widget` for a stated reason: a widget
 * lives INSIDE the scrolling content, so it tracks the table with no geometry
 * code and cannot drift on scroll. Edge handles require exactly the geometry
 * code that shape was chosen to avoid — `measure()` above reads real rects and
 * writes real offsets. That was an accepted trade, not an oversight: the
 * widget still supplies the scroll-tracking origin for free, so the geometry
 * is relative and small, and it buys a control the user will actually use.
 *
 * Like `HeadingFold` and the bar before it, this is an `Extension`: it
 * registers nothing in the schema and mutates no document, so every Markdown
 * round-trip test is blind to whether it runs at all. `tableHandles.test.ts`
 * asserts on the decoration set and on command dispatch, because nothing else
 * in the suite can see this plugin — and it asserts on neither position nor
 * rect, because jsdom has no layout engine. Positioning is Playwright's.
 */
export const TableHandles = Extension.create<TableHandlesOptions>({
  name: 'tableHandles',

  addOptions() {
    return { labels: null };
  },

  addProseMirrorPlugins() {
    const { labels } = this.options;
    if (labels === null) return [];

    /**
     * Every live layer's `measure()`. A widget is created by the decoration
     * pass but must be re-measured by events the decoration pass never sees —
     * a window resize above all — so the closures are collected here and the
     * plugin's `view()` drives them.
     */
    const measurers = new Set<() => void>();
    const measureAll = (): void => {
      for (const measure of measurers) measure();
    };

    return [
      new Plugin({
        key: tableHandlesKey,

        props: {
          decorations(state) {
            const pos = tablePosAt(state);
            if (pos === null) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                pos,
                (view) => {
                  const { dom, measure } = handlesLayer(view, pos, labels);
                  measurers.add(measure);
                  // Stored so `destroy` below can drop exactly this closure
                  // rather than clearing the set.
                  Reflect.set(dom, '__bearMeasure', measure);
                  return dom;
                },
                {
                  // Before the table, so the layer's own box sits at the
                  // table's top-left corner and every offset `measure()`
                  // writes is a small relative number.
                  side: -1,
                  // Keyed so the widget is reused across the many transactions
                  // that do not move the caret out of this table — without it
                  // every keystroke inside a cell rebuilds every handle.
                  key: `table-handles-${pos}`,
                  // Chrome, not content: it must never appear in the document
                  // ProseMirror serializes, nor absorb a caret.
                  ignoreSelection: true,
                  destroy(dom) {
                    const measure = Reflect.get(dom, '__bearMeasure');
                    if (typeof measure === 'function') measurers.delete(measure as () => void);
                  },
                },
              ),
            ]);
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const button = target?.closest('[data-table-handle]');
              if (!button) return false;

              // Right- and middle-clicks are not activations. Same guard the
              // fold gutter's own handler carries.
              if (event.button !== 0) return false;

              // Stops the caret from being placed into the widget and stops
              // the editor losing focus, so the command below runs against the
              // selection this handler is about to set.
              event.preventDefault();

              const kind = button.getAttribute('data-table-handle');
              const index = Number(button.getAttribute('data-index'));
              if ((kind !== 'row' && kind !== 'column') || !Number.isInteger(index)) return false;

              return activate(view, kind, index);
            },
          },
        },

        view() {
          // A resize changes every rect `measure()` reads and produces no
          // transaction at all, so the decoration pass never runs. Registered
          // and torn down here because a plugin has no component lifecycle to
          // hang a listener from; `view()` is ProseMirror's equivalent.
          window.addEventListener('resize', measureAll);
          return {
            update: measureAll,
            destroy() {
              window.removeEventListener('resize', measureAll);
              measurers.clear();
            },
          };
        },
      }),
    ];
  },
});

/**
 * Moves the selection into the cell the handle names, then inserts after it.
 *
 * The two steps are not interchangeable and the order is the bug this whole
 * module exists to avoid: `addRowAfter`/`addColumnAfter` read the selection,
 * so running them first inserts next to the CARET — which is almost never the
 * row or column the user pointed at, and which a test asserting only "a row
 * was added" would pass.
 */
function activate(view: EditorView, kind: HandleKind, index: number): boolean {
  const tablePos = tablePosAt(view.state);
  if (tablePos === null) return false;

  // A row handle acts through that row's first cell; a column handle through
  // the first row's cell in that column. Either identifies the target
  // rectangle `prosemirror-tables` needs, and neither depends on where the
  // caret was.
  const target =
    kind === 'row'
      ? cellTextPos(view.state.doc, tablePos, index, 0)
      : cellTextPos(view.state.doc, tablePos, 0, index);
  if (target === null) return false;

  const tr = view.state.tr;
  tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
  view.dispatch(tr);

  // `view.state` is the post-dispatch state, so the command below sees the
  // selection just set rather than the one the user left behind.
  const command: (state: EditorState, dispatch?: EditorView['dispatch']) => boolean =
    kind === 'row' ? COMMANDS.addRowAfter : COMMANDS.addColumnAfter;
  command(view.state, view.dispatch);
  view.focus();
  return true;
}
