import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { renderIconMarkup, GripHorizontal, GripVertical } from '@/ui/Icon';

import { tablePosAt } from './tablePos';
import { COMMANDS } from './tableCommands';

export interface TableHandlesOptions {
  /**
   * Accessible name for a handle button, one per kind. It is also the menu's
   * own `aria-label` (`TableHandleMenu`'s `role="menu"`) — the button's whole
   * job is "open this menu", so one string covers both, the way `HeadingFold`'s
   * `foldHint` doubles as the toggle's name. `null` when nobody supplied them,
   * which is the state of the schema-only `editorExtensions` constant, and in
   * that state no plugin is registered at all and no handle is drawn.
   *
   * Absent rather than unlabelled, deliberately: no user-facing string may be
   * hardcoded in this app, and an icon-only button with no accessible name is
   * invisible to a screen reader. Same shape as `HeadingFold`'s `foldHint` and
   * `TagPill`'s `onActivate`, for the same reason.
   */
  labels: { row: string; column: string } | null;
  /**
   * Called when the user clicks a row or column handle, with enough for the
   * app to open a menu scoped to that handle: which table, which kind, which
   * index, the button's own rect (for anchoring) and the button itself (so the
   * app can flip `aria-expanded` and return focus on close without a second
   * DOM lookup). `null` when nobody is listening — same "nobody is listening"
   * contract as `HeadingFold.onOpenMenu`, and for the same reason a raw plugin
   * cannot reach for React on its own. Named `onOpenTableMenu`, not
   * `onOpenMenu`, because `HeadingFoldOptions` and `TableHandlesOptions` are
   * merged into one options object at the call site
   * (`buildSupportedExtensions`'s `Partial<... & HeadingFoldOptions &
   * TableHandlesOptions & ...>`) — sharing the name would have one silently
   * shadow the other.
   */
  onOpenTableMenu: ((request: TableHandleMenuRequest) => void) | null;
}

export interface TableHandleMenuRequest {
  /** Document position of the table node the clicked handle belongs to. */
  tablePos: number;
  kind: HandleKind;
  /** The row or column index the handle names — NOT the caret's. */
  index: number;
  /** Viewport rectangle of the handle, for anchoring the menu. */
  rect: DOMRect;
  /** The handle button itself, for `aria-expanded` bookkeeping and focus return. */
  anchor: HTMLButtonElement;
}

/**
 * The three actions a row or column handle's menu can run, restricted from
 * `TableAction`'s full seven — a handle names one row or column, so
 * `deleteTable` (which needs neither) is not offered here. Typed as a literal
 * subset rather than the bare `TableAction` so a future menu item cannot pass
 * an action the handle's own `runTableHandleAction` command was never meant to
 * receive.
 */
export type TableHandleAction =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn';

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

export type HandleKind = 'row' | 'column';

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

// Computed ONCE at module init, not per render — `renderIconMarkup` touches
// the DOM on every call, and `handlesLayer.measure()`/the rebuild guard below
// call `handleElement` far more often than the glyph itself ever changes. Two
// glyphs, not one shared between kinds: `GripHorizontal`'s three-wide,
// two-tall dot cluster reads as a WIDE shape (a row), `GripVertical`'s
// two-wide, three-tall cluster reads as a TALL one (a column) — the same
// "shape says what it names" reasoning `Rows3`/`Columns3` already use
// elsewhere in this editor.
const ROW_HANDLE_MARKUP = renderIconMarkup(GripHorizontal, 'sm');
const COLUMN_HANDLE_MARKUP = renderIconMarkup(GripVertical, 'sm');

function handleElement(kind: HandleKind, index: number, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bear-table-handle';
  button.contentEditable = 'false';
  button.setAttribute('data-table-handle', kind);
  button.setAttribute('data-index', String(index));
  // Icon-only, and therefore labelled. The glyph changed from `+` to a grip
  // because this button no longer inserts on click — it OPENS A MENU, and a
  // `+` that opens a menu instead of adding something is a lie the user
  // discovers the moment they click it. `docs/rulings/tables.md` is amended
  // alongside this change to say so.
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  // A button that opens a menu says so. `aria-expanded` starts `false` and is
  // flipped imperatively by the app when the menu opens/closes (see
  // `RichEditor`'s `onOpenTableMenu`/`onClose` for the table handle menu) — this
  // plugin has no view of whether React's menu is currently mounted, only the
  // moment a click asks to open one.
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = kind === 'row' ? ROW_HANDLE_MARKUP : COLUMN_HANDLE_MARKUP;
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
): { dom: HTMLElement; measure: () => void; destroy: () => void } {
  const layer = document.createElement('div');
  layer.className = 'bear-table-handles';
  // Chrome, not content. `contentEditable = 'false'` keeps it out of anything
  // ProseMirror reads back from the DOM; `pointer-events` is re-enabled on the
  // buttons alone, in CSS, so the layer cannot shadow the prose beneath it.
  layer.contentEditable = 'false';

  /*
   * The scroll container Tiptap wraps every table in, which J3 made scrollable.
   *
   * The handle layer is a widget at the position BEFORE the table, so it is a
   * SIBLING of this wrapper and lives outside it — which is why the CSS reveal
   * rule reads `:has(+ .tableWrapper:hover)`. Being outside means two things
   * once the wrapper can scroll: the handles do not move with the cells they
   * point at, and they are not clipped when those cells scroll out of view.
   * `measure` below answers both.
   */
  let scrollTarget: HTMLElement | null = null;
  let frame: number | null = null;

  const onScroll = (): void => {
    // Coalesced to one measure per frame. A transaction fires a handful of
    // times a second; a scroll fires on every frame of a fling, and each
    // measure reads layout for every row and column in the table.
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      measure();
    });
  };

  const measure = (): void => {
    const table = tableElement(view, pos);
    if (table === null) return;

    const wrapper = table.closest('.tableWrapper');
    const container = wrapper instanceof HTMLElement ? wrapper : table;
    if (container !== scrollTarget) {
      scrollTarget?.removeEventListener('scroll', onScroll);
      scrollTarget = container;
      scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    }
    // What the user can actually SEE of the table. Equal to the table's own
    // box until it is scrolled, so nothing below changes behaviour for a
    // table that fits.
    const clip = container.getBoundingClientRect();

    // DIRECT children only. `tableCell`'s content is `block+`, so a nested
    // table is schema-legal even though GFM cannot express one — and a bare
    // `querySelectorAll('tr')` would descend into it, joining its rows to this
    // table's and silently breaking the row-index ↔ node-child-index bridge
    // `cellTextPos` depends on.
    const rows = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr'));
    const columns = Array.from(rows[0]?.children ?? []).filter(
      (cell): cell is HTMLElement => cell instanceof HTMLElement,
    );

    // Rebuild only when the SHAPE changed. A table is re-measured on every
    // transaction, and rebuilding unconditionally would drop focus from a
    // handle a keyboard user had just tabbed to.
    //
    // The signature is TWO-DIMENSIONAL, and a sum will not do. `3x2` and `2x3`
    // both total five, so a single update that transposes a table would keep
    // the stale children — and buttons still labelled `row` would be
    // repositioned along the column edge, so the leftmost column handle would
    // insert a ROW. That is reachable in normal use, not a curiosity:
    // `prosemirror-history` groups steps within 500ms, so one `Ctrl+Z` over a
    // quick "delete row, add column" pair produces exactly that one update, as
    // does a paste replacing the table.
    const signature = `${String(rows.length)}x${String(columns.length)}`;
    if (layer.getAttribute('data-shape') !== signature) {
      layer.setAttribute('data-shape', signature);
      layer.replaceChildren(
        ...rows.map((_row, index) => handleElement('row', index, labels.row)),
        ...columns.map((_cell, index) => handleElement('column', index, labels.column)),
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
      // Pinned to the VISIBLE left edge, not the table's. They are the same
      // until the table is scrolled; after that, tracking `bounds.left` would
      // walk the row handles left across the prose, because this layer sits
      // outside the scroll container and nothing clips it.
      button.style.left = `${clip.left - origin.left - ROW_GAP}px`;
      button.style.top = `${rect.top + rect.height / 2 - origin.top}px`;
    });

    columns.forEach((cell, index) => {
      const button = buttons[rows.length + index];
      if (button === undefined) return;
      const rect = cell.getBoundingClientRect();
      const centre = rect.left + rect.width / 2;
      // Hidden when its column has scrolled out of sight. `visibility`, not
      // `display`: the button keeps its box and its place in the tab order, so
      // a keyboard user's focus is not thrown out of the layer by a scroll.
      button.style.visibility = centre < clip.left || centre > clip.right ? 'hidden' : '';
      button.style.left = `${centre - origin.left}px`;
      button.style.top = `${bounds.top - origin.top}px`;
    });
  };

  measure();
  return {
    dom: layer,
    measure,
    destroy: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scrollTarget?.removeEventListener('scroll', onScroll);
      scrollTarget = null;
    },
  };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableHandles: {
      /**
       * Runs one of the three row/column handle actions against the row or
       * column NAMED by `tablePos`/`kind`/`index` — never the caret's. This is
       * the command `TableHandleMenu`'s buttons call, through
       * `editor.commands`, so the menu itself needs no access to `view` or to
       * `cellTextPos`.
       */
      runTableHandleAction: (
        tablePos: number,
        kind: HandleKind,
        index: number,
        action: TableHandleAction,
      ) => ReturnType;
    };
  }
}

/**
 * `⣿` grip handles on a table's row and column edges, revealed on hover, that
 * open a menu scoped to the row or column they sit on.
 *
 * NOT the bar this replaces, and the difference is the point. The bar was five
 * words floating above the user's prose — a control that named the table
 * rather than pointing at a part of it, and one the user rejected outright
 * ("I do not want a text-written button"). These handles put the control where
 * the thing is: the handle beside row three opens a menu scoped to row three,
 * with no reading and no aiming at a shared bar.
 *
 * A handle used to insert directly on click (`+`, "add after"); it now opens a
 * menu instead, because deletion had nowhere discoverable to live. Right-click
 * has no affordance anywhere in this app, so a user who saw only `+` handles
 * had no way to find `Delete row`/`Delete column` at all — see
 * `docs/rulings/tables.md`'s amended entry on this. The glyph changed from
 * `+` to a grip for the same reason: a `+` that opens a menu instead of adding
 * something is a lie the moment it is clicked.
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
 *
 * The plugin never reaches for `Editor` or for React, same boundary
 * `HeadingFold.onOpenMenu` and `TagPill.onActivate` both keep: a click reports
 * a request upward (`onOpenTableMenu`), and the app draws the menu. What DOES run
 * inside the plugin's own command (`runTableHandleAction`, above) is the
 * selection-then-command sequence a menu choice ultimately triggers — that is
 * `state`/`dispatch`/`view`, all things a `prosemirror-tables` command already
 * needed, not a new dependency on the layer above.
 */
export const TableHandles = Extension.create<TableHandlesOptions>({
  name: 'tableHandles',

  addOptions() {
    return { labels: null, onOpenTableMenu: null };
  },

  addCommands() {
    return {
      /**
       * Moves the selection into the cell (`tablePos`, `kind`, `index`) names,
       * then runs `action`. The two steps are not interchangeable and the
       * order is the bug this whole module exists to avoid:
       * `prosemirror-tables`' commands read the selection, so running one
       * first acts on the CARET — which is almost never the row or column the
       * user pointed at, and which a test asserting only "a row changed"
       * would pass. This is the ONLY route to a row/column action now that a
       * click opens a menu instead of acting directly — `TableHandleMenu`'s
       * buttons reach here through `editor.commands.runTableHandleAction`.
       *
       * Deliberately does NOT call `view.dispatch` itself. `editor.commands.X`
       * builds ONE outer transaction (`CommandManager.commands`'s `tr`) and
       * dispatches it once, after this function returns — a manual
       * `view.dispatch` in here would apply a SECOND, competing transaction
       * mid-command and throw "Applying a mismatched transaction" the moment
       * Tiptap tried to apply its own stale outer `tr` on top of an
       * already-advanced `view.state`. So this works entirely through the
       * `tr`/`state`/`dispatch` this command was HANDED — the same shared
       * transaction `COMMANDS[action]` below builds on.
       */
      runTableHandleAction:
        (tablePos: number, kind: HandleKind, index: number, action: TableHandleAction) =>
        ({ state, tr, dispatch }) => {
          const row = kind === 'row' ? index : 0;
          const column = kind === 'row' ? 0 : index;
          const target = cellTextPos(state.doc, tablePos, row, column);
          if (target === null) return false;

          // A dry run (`editor.can()`) must not move the selection either.
          if (!dispatch) return true;

          tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
          // Tiptap's chainable `state` (`createChainableState`) caches
          // `selection`/`doc` off the transaction and only resyncs them when
          // `.tr` itself is accessed — and `prosemirror-tables`' commands
          // (`selectedRect`, `isInTable`) read `state.selection` BEFORE ever
          // touching `.tr`. Without this second access, `COMMANDS[action]`
          // below would still see the selection this command started with,
          // not the one just set two lines up.
          void state.tr;

          return COMMANDS[action](state, dispatch);
        },
    };
  },

  addProseMirrorPlugins() {
    const { labels, onOpenTableMenu } = this.options;
    if (labels === null) return [];

    /**
     * Every live layer's `measure()`, keyed by the layer element itself. A
     * widget is created by the decoration pass but must be re-measured by
     * events the decoration pass never sees — a window resize above all — so
     * the closures are collected here and the plugin's `view()` drives them.
     *
     * Keyed by the DOM node because that is exactly what the widget's own
     * `destroy` receives, so one layer's closure can be dropped without the
     * plugin having to stash anything on the element.
     */
    const measurers = new Map<HTMLElement, () => void>();
    const releasers = new Map<HTMLElement, () => void>();
    const measureAll = (): void => {
      for (const measure of measurers.values()) measure();
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
                  const { dom, measure, destroy } = handlesLayer(view, pos, labels);
                  measurers.set(dom, measure);
                  // Held beside the measurer so the widget's own `destroy`
                  // below can release the layer's scroll listener. Without
                  // this a table scrolled and then left keeps a listener on
                  // DOM ProseMirror has already discarded.
                  releasers.set(dom, destroy);
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
                    measurers.delete(dom as HTMLElement);
                    releasers.get(dom as HTMLElement)?.();
                    releasers.delete(dom as HTMLElement);
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
              // the editor losing focus.
              event.preventDefault();

              const kind = button.getAttribute('data-table-handle');
              // `parseInt`, not `Number`: `Number(null)` is `0`, and `0` is a
              // perfectly good integer — so a handle element that somehow
              // carried no `data-index` would be silently treated as index 0
              // and act on the wrong row. `parseInt('')` is `NaN`, which the
              // guard below rejects.
              const index = Number.parseInt(button.getAttribute('data-index') ?? '', 10);
              if ((kind !== 'row' && kind !== 'column') || !Number.isInteger(index)) return false;

              if (onOpenTableMenu === null) return false;

              const tablePos = tablePosAt(view.state);
              if (tablePos === null) return false;

              const anchor = button as HTMLButtonElement;
              // Flipped back to `false` by the app when the menu closes (see
              // `RichEditor`'s `onClose` for this menu) — the plugin has no
              // signal of its own for "the menu closed", since the menu is
              // React state, not plugin state.
              anchor.setAttribute('aria-expanded', 'true');

              onOpenTableMenu({
                tablePos,
                kind,
                index,
                rect: anchor.getBoundingClientRect(),
                anchor,
              });
              return true;
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
              for (const release of releasers.values()) release();
              releasers.clear();
              measurers.clear();
            },
          };
        },
      }),
    ];
  },
});
