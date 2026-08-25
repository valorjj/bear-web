import { Editor, getSchema } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';
import { cellTextPos, TableHandles, type TableHandleMenuRequest } from './TableHandles';
import { tablePosAt } from './tablePos';

const LABELS = { row: 'Row options', column: 'Column options' };

/** Two columns, a header row and two body rows. */
const TABLE_HTML =
  '<table><tbody>' +
  '<tr><th><p>a</p></th><th><p>b</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
  '<tr><td><p>3</p></td><td><p>4</p></td></tr>' +
  '</tbody></table>';

/** Three columns, a header row and one body row. */
const WIDE_TABLE_HTML =
  '<table><tbody>' +
  '<tr><th><p>a</p></th><th><p>b</p></th><th><p>c</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr>' +
  '</tbody></table>';

/**
 * Records every `onOpenTableMenu` request, so a test can assert not just that
 * one FIRED but what it named — the request is what carries "which row or
 * column", which is the whole point of this menu route existing.
 */
function labelled(content: string): { editor: Editor; requests: TableHandleMenuRequest[] } {
  const requests: TableHandleMenuRequest[] = [];
  const editor = new Editor({
    extensions: buildEditorExtensions({
      labels: LABELS,
      onOpenTableMenu: (request) => requests.push(request),
    }),
    content,
  });
  return { editor, requests };
}

/**
 * Puts the caret inside the table's FIRST body cell — row index 1, column
 * index 0 — and returns nothing.
 *
 * Every test below then acts on a DIFFERENT row or column, which is the only
 * way to tell "acted on the handle's row" apart from "acted on the caret's
 * row". The bar this module replaced could only ever do the latter.
 */
function caretInFirstBodyCell(editor: Editor): void {
  let pos: number | null = null;
  editor.state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === 'tableCell') pos = at + 2;
    return pos === null;
  });
  expect(pos).not.toBeNull();
  editor.commands.setTextSelection(pos!);
}

function layer(editor: Editor): Element | null {
  return editor.view.dom.querySelector('.bear-table-handles');
}

function handles(editor: Editor, kind: 'row' | 'column'): Element[] {
  return [...editor.view.dom.querySelectorAll(`[data-table-handle="${kind}"]`)];
}

function handleAt(editor: Editor, kind: 'row' | 'column', index: number): Element {
  const el = editor.view.dom.querySelector(`[data-table-handle="${kind}"][data-index="${index}"]`);
  expect(el, `no ${kind} handle at index ${index}`).not.toBeNull();
  return el!;
}

/**
 * Invokes the plugin's own `handleDOMEvents.mousedown` against the REAL
 * mounted view — the same approach `headingFold.test.ts` uses, and for the
 * same reason: this handler resolves through `closest()` on the event target,
 * so it needs no layout engine, only a real element.
 */
function mousedownOn(
  editor: Editor,
  element: Element,
  init: MouseEventInit = {},
): { handled: boolean; defaultPrevented: boolean } {
  const event = new MouseEvent('mousedown', {
    cancelable: true,
    bubbles: true,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: element, configurable: true });
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined ? false : handlers.mousedown(editor.view, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

describe('the table handles schema contract', () => {
  // Same blind spot `HeadingFold` documents: this is an Extension that
  // decorates and never mutates, so every Markdown round-trip test in the
  // suite passes whether or not the plugin runs at all. Only assertions on
  // the decoration set and on the commands can see it.
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).not.toContain('tableHandles');
    expect(Object.keys(schema.marks)).not.toContain('tableHandles');
  });

  it('leaves the table byte-identical while the handles are showing', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    expect(layer(editor)).not.toBeNull();
    // Padded cells and a three-dash minimum in the alignment row: that is what
    // this serializer produces, and `docs/rulings/tables.md` says not to tidy
    // the pinned string into something prettier but false. The trailing blank
    // line is `TrailingNode`'s paragraph, not the table's.
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n\n',
    );

    editor.destroy();
  });
});

describe('the handle layer', () => {
  it('decorates nothing while the caret is outside a table', () => {
    const { editor } = labelled(`<p>before</p>${TABLE_HTML}`);
    editor.commands.setTextSelection(1);

    expect(layer(editor)).toBeNull();

    editor.destroy();
  });

  it('appears when the caret moves into the table, and goes again when it leaves', () => {
    const { editor } = labelled(`<p>before</p>${TABLE_HTML}`);

    caretInFirstBodyCell(editor);
    expect(layer(editor)).not.toBeNull();

    editor.commands.setTextSelection(1);
    expect(layer(editor)).toBeNull();

    editor.destroy();
  });

  // One handle per `<tr>` and one per cell of the first row. No geometry is
  // asserted anywhere in this file — jsdom has no layout engine, so every
  // rect it reports is zero, and a positional assertion here would be
  // measuring the stub rather than the code. Positioning belongs to
  // Playwright.
  it('draws one handle per row and one per column, each carrying its index', () => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);

    expect(handles(editor, 'row').map((el) => el.getAttribute('data-index'))).toEqual(['0', '1']);
    expect(handles(editor, 'column').map((el) => el.getAttribute('data-index'))).toEqual([
      '0',
      '1',
      '2',
    ]);

    editor.destroy();
  });

  it('labels every handle with the caller’s own string, and marks it as a menu opener', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const row = handleAt(editor, 'row', 0);
    const column = handleAt(editor, 'column', 0);

    expect(row.getAttribute('aria-label')).toBe(LABELS.row);
    expect(column.getAttribute('aria-label')).toBe(LABELS.column);
    // A button that opens a menu says so, and starts closed.
    expect(row.getAttribute('aria-haspopup')).toBe('menu');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(column.getAttribute('aria-haspopup')).toBe('menu');
    expect(column.getAttribute('aria-expanded')).toBe('false');

    editor.destroy();
  });

  // The schema-only `editorExtensions` constant supplies no labels. No
  // user-facing string may be hardcoded in this app, and an icon-only button
  // with no accessible name is invisible to a screen reader — so with no
  // labels there is no plugin at all.
  it('registers no plugin when the caller supplied no labels', () => {
    const editor = new Editor({ extensions: editorExtensions, content: TABLE_HTML });
    caretInFirstBodyCell(editor);

    expect(layer(editor)).toBeNull();

    editor.destroy();
  });

  // `tablePosAt` walks outward from the cursor rather than scanning the
  // document, so a table inside a blockquote resolves to the table and not to
  // an ancestor. This is the case that walk exists for.
  it('resolves the INNERMOST table when one is nested in a blockquote', () => {
    const { editor } = labelled(`<blockquote>${TABLE_HTML}</blockquote>`);
    caretInFirstBodyCell(editor);

    const pos = tablePosAt(editor.state);
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('table');
    expect(handles(editor, 'row')).toHaveLength(3);

    editor.destroy();
  });
});

describe('clicking a handle opens a menu scoped to ITS OWN row or column, not the caret’s', () => {
  // The caret sits in row 1 / column 0 in every case below, and the handle
  // clicked is always a DIFFERENT index — the only way to tell "the menu is
  // scoped to the handle" apart from "the menu is scoped to the caret".
  it('reports the row the handle names, not the caret’s row', () => {
    const { editor, requests } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    const target = handleAt(editor, 'row', 2);
    const result = mousedownOn(editor, target);

    expect(result.handled).toBe(true);
    // Without `preventDefault` the caret is placed into the widget and
    // whatever the menu eventually acts on would drift with it.
    expect(result.defaultPrevented).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ tablePos, kind: 'row', index: 2 });
    expect(requests[0]!.anchor).toBe(target);
    // No document mutation from the click alone — only the menu opened.
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n\n',
    );
    // Flipped synchronously, not left for React to catch up to later — the
    // plugin has no other chance to say "a menu is now open" for this button.
    expect(target.getAttribute('aria-expanded')).toBe('true');

    editor.destroy();
  });

  it('reports the column the handle names, not the caret’s column', () => {
    const { editor, requests } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    const target = handleAt(editor, 'column', 2);
    mousedownOn(editor, target);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ tablePos, kind: 'column', index: 2 });

    editor.destroy();
  });

  it('reports the header row when the header handle is clicked', () => {
    const { editor, requests } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    mousedownOn(editor, handleAt(editor, 'row', 0));

    expect(requests[0]).toMatchObject({ kind: 'row', index: 0 });

    editor.destroy();
  });

  it('ignores a right-click and opens nothing', () => {
    const { editor, requests } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, handleAt(editor, 'row', 2), { button: 2 });

    expect(result.handled).toBe(false);
    expect(requests).toHaveLength(0);

    editor.destroy();
  });

  it('lets a click on the prose fall through to the editor', () => {
    const { editor, requests } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, editor.view.dom);

    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);
    expect(requests).toHaveLength(0);

    editor.destroy();
  });

  it('opens nothing when nobody is listening', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ labels: LABELS, onOpenTableMenu: null }),
      content: TABLE_HTML,
    });
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, handleAt(editor, 'row', 2));

    expect(result.handled).toBe(false);

    editor.destroy();
  });
});

describe('runTableHandleAction acts on the row or column NAMED, not the caret’s', () => {
  // This is the command `TableHandleMenu`'s buttons call, via
  // `editor.commands`. Same discipline as the click tests above: caret stays
  // in row 1 / column 0 throughout, and the action always targets a different
  // index, so each expectation distinguishes "acted on the request" from
  // "acted on the caret" rather than merely asserting "something changed".
  //
  //   caret-based `addRowAfter` would put the blank row between `1 | 2` and
  //   `3 | 4`; targeting row 2 puts it at the end.
  //   caret-based `addColumnAfter` would put the blank column between `a` and
  //   `b`; targeting column 2 puts it at the end.
  it('inserts a row after the row named, regardless of the caret', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    const result = editor.commands.runTableHandleAction(tablePos, 'row', 2, 'addRowAfter');

    expect(result).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n|     |     |\n\n',
    );

    editor.destroy();
  });

  it('inserts a row above the row named', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    editor.commands.runTableHandleAction(tablePos, 'row', 2, 'addRowBefore');

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n| 3   | 4   |\n\n',
    );

    editor.destroy();
  });

  it('inserts a row after the HEADER when row 0 is named', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    editor.commands.runTableHandleAction(tablePos, 'row', 0, 'addRowAfter');

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n| 3   | 4   |\n\n',
    );

    editor.destroy();
  });

  it('inserts a column after the column named, regardless of the caret', () => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    editor.commands.runTableHandleAction(tablePos, 'column', 2, 'addColumnAfter');

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   | c   |     |\n| --- | --- | --- | --- |\n| 1   | 2   | 3   |     |\n\n',
    );

    editor.destroy();
  });

  it('inserts a column before the MIDDLE column when column 1 is named', () => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    editor.commands.runTableHandleAction(tablePos, 'column', 1, 'addColumnBefore');

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   |     | b   | c   |\n| --- | --- | --- | --- |\n| 1   |     | 2   | 3   |\n\n',
    );

    editor.destroy();
  });

  // The sharpest version of "acted on the named row/column, not the
  // caret's": the caret sits in row 1, but `deleteRow` is asked to remove row
  // 2 — the row the caret is IN must survive.
  it('deletes the row named, leaving the caret’s own row intact', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    const result = editor.commands.runTableHandleAction(tablePos, 'row', 2, 'deleteRow');

    expect(result).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n',
    );

    editor.destroy();
  });

  it('deletes the column named, leaving the caret’s own column intact', () => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    const result = editor.commands.runTableHandleAction(tablePos, 'column', 2, 'deleteColumn');

    expect(result).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n',
    );

    editor.destroy();
  });

  it('returns false and mutates nothing for an out-of-range index', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;
    const before = serializeMarkdown(editor.getJSON());

    const result = editor.commands.runTableHandleAction(tablePos, 'row', 99, 'deleteRow');

    expect(result).toBe(false);
    expect(serializeMarkdown(editor.getJSON())).toBe(before);

    editor.destroy();
  });

  it('is a dry run under editor.can(), and mutates nothing', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;
    const before = serializeMarkdown(editor.getJSON());

    const can = editor.can().runTableHandleAction(tablePos, 'row', 2, 'deleteRow');

    expect(can).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(before);

    editor.destroy();
  });
});

describe('cellTextPos', () => {
  // The arithmetic the whole module turns on — three `+1`s, one past each of
  // the table's, the row's and the cell's own opening token. It is otherwise
  // covered only transitively through the action tests above, where an
  // off-by-one would surface as a mysteriously wrong Markdown string rather
  // than as "this position is in the wrong cell".
  //
  // Asserted through the CELL'S OWN TEXT rather than as a number: a pinned
  // integer would be a restatement of the implementation, whereas "the
  // position for (1, 0) resolves inside the cell reading `1`" is the property
  // the callers actually need.
  //
  // It is asserted through `TextSelection.near` because that is precisely what
  // `moveSelectionAndRun` does with the result. The raw position lands inside
  // the cell but BEFORE its paragraph, so reading `$pos.parent` off it would
  // report the cell — true, and not the property that matters. `near` is what
  // turns it into the caret the table commands then read.
  function cellTextAt(
    doc: ProseMirrorNode,
    tablePos: number,
    row: number,
    column: number,
  ): { text: string; caretIn: string } | null {
    const pos = cellTextPos(doc, tablePos, row, column);
    if (pos === null) return null;
    const { $from } = TextSelection.near(doc.resolve(pos));
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        return { text: node.textContent, caretIn: $from.parent.type.name };
      }
    }
    return null;
  }

  it.each([
    [0, 0, 'a'],
    [0, 1, 'b'],
    [0, 2, 'c'],
    [1, 0, '1'],
    [1, 1, '2'],
    [1, 2, '3'],
  ])('resolves cell (%i, %i) to the cell reading %s', (row, column, text) => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    // `caretIn` pins the caret as landing in the cell's PARAGRAPH: one `+1`
    // too few would still be somewhere in the right cell's neighbourhood and
    // would still serialize plausibly.
    expect(cellTextAt(editor.state.doc, tablePos, row, column)).toEqual({
      text,
      caretIn: 'paragraph',
    });

    editor.destroy();
  });

  it.each([
    ['a negative row', -1, 0],
    ['a row past the end', 2, 0],
    ['a negative column', 0, -1],
    ['a column past the end', 0, 3],
  ])('returns null for %s', (_name, row, column) => {
    const { editor } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    const tablePos = tablePosAt(editor.state)!;

    expect(cellTextPos(editor.state.doc, tablePos, row, column)).toBeNull();

    editor.destroy();
  });

  it('returns null when the position is not a table', () => {
    const { editor } = labelled('<p>plain</p>');

    expect(cellTextPos(editor.state.doc, 0, 0, 0)).toBeNull();

    editor.destroy();
  });
});

describe('the shape guard', () => {
  /**
   * Replaces the table the caret is in with one of the given dimensions, in a
   * SINGLE transaction that leaves the selection inside the new table.
   *
   * Both halves matter. One transaction is what a grouped undo produces —
   * `prosemirror-history` groups steps within 500ms, so a quick "delete row,
   * add column" pair comes back as one update. Keeping the selection inside
   * the table at the same position keeps the decoration's `key` identical, so
   * the widget is REUSED rather than rebuilt — which is the only state in
   * which a stale child can survive.
   */
  function transposeTable(editor: Editor, rows: number, columns: number): void {
    const { schema } = editor;
    const at = tablePosAt(editor.state)!;
    const old = editor.state.doc.nodeAt(at)!;

    const cell = (type: 'tableHeader' | 'tableCell', text: string) =>
      schema.nodes[type]!.create(null, schema.nodes.paragraph!.create(null, schema.text(text)));

    const table = schema.nodes.table!.create(
      null,
      Array.from({ length: rows }, (_row, r) =>
        schema.nodes.tableRow!.create(
          null,
          Array.from({ length: columns }, (_column, c) =>
            cell(r === 0 ? 'tableHeader' : 'tableCell', `r${String(r)}c${String(c)}`),
          ),
        ),
      ),
    );

    const tr = editor.state.tr.replaceWith(at, at + old.nodeSize, table);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
    editor.view.dispatch(tr);
  }

  /** Each handle as `<kind><index>`, in the layer's own DOM order. */
  function handleOrder(editor: Editor): string[] {
    return [...(layer(editor)?.children ?? [])].map(
      (el) =>
        `${el.getAttribute('data-table-handle') ?? '?'}${el.getAttribute('data-index') ?? '?'}`,
    );
  }

  // 3×2 and 2×3 both total five handles, so a guard that compares a SUM sees
  // no change and keeps the stale children. The buttons are then repositioned
  // by their DOM index — rows first, then columns — so the leftmost column
  // position ends up holding a button still marked `row`, and clicking it
  // would open a menu that claims to be about a row when the button now sits
  // at a column edge. That is the "acts on the wrong thing" failure this
  // whole module exists to prevent.
  it('rebuilds when a table transposes without changing its handle COUNT', () => {
    const { editor } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);
    expect(handleOrder(editor)).toEqual(['row0', 'row1', 'row2', 'column0', 'column1']);

    transposeTable(editor, 2, 3);

    expect(handleOrder(editor)).toEqual(['row0', 'row1', 'column0', 'column1', 'column2']);

    editor.destroy();
  });

  it('leaves the leftmost column handle reporting a COLUMN after a transpose', () => {
    const { editor, requests } = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    transposeTable(editor, 2, 3);
    const tablePos = tablePosAt(editor.state)!;

    // Addressed by POSITION in the layer — the first handle after the row
    // handles is the one drawn at the leftmost column — not by its own
    // `data-*`, which is the very thing that goes stale.
    const first = layer(editor)!.children[2]!;
    expect(mousedownOn(editor, first).handled).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'column', index: 0 });

    // Running the reported action confirms it targets a COLUMN, not a stale
    // ROW: a blank column lands between `r0c0` and `r0c1`. Had a stale `row`
    // handle survived there, this would either fail or insert a blank row
    // instead, and every row would still have three cells.
    editor.commands.runTableHandleAction(
      tablePos,
      requests[0]!.kind,
      requests[0]!.index,
      'addColumnAfter',
    );
    expect(serializeMarkdown(editor.getJSON())).toBe(
      [
        // The blank column is padded to the alignment row's three-dash
        // minimum, not to the other columns' width — the serializer's own
        // behaviour, per `docs/rulings/tables.md`.
        '| r0c0 |     | r0c1 | r0c2 |',
        '| ---- | --- | ---- | ---- |',
        '| r1c0 |     | r1c1 | r1c2 |',
        '',
        '',
      ].join('\n'),
    );

    editor.destroy();
  });

  // The other direction, and the sharper failure. Going 2×3 → 3×2 under a
  // sum-based guard leaves a button marked `column` sitting at the THIRD ROW's
  // position, so clicking it would report a column when the user pointed at a
  // row. "Reports the wrong thing" is the bug this module exists to prevent.
  it('leaves the last row handle reporting a ROW after the reverse transpose', () => {
    const { editor, requests } = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);
    expect(handleOrder(editor)).toEqual(['row0', 'row1', 'column0', 'column1', 'column2']);

    transposeTable(editor, 3, 2);
    const tablePos = tablePosAt(editor.state)!;

    // Addressed by POSITION again: the third handle is the one drawn at the
    // last row's edge.
    const third = layer(editor)!.children[2]!;
    expect(mousedownOn(editor, third).handled).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'row', index: 2 });

    editor.commands.runTableHandleAction(
      tablePos,
      requests[0]!.kind,
      requests[0]!.index,
      'deleteRow',
    );
    expect(serializeMarkdown(editor.getJSON())).toBe(
      ['| r0c0 | r0c1 |', '| ---- | ---- |', '| r1c0 | r1c1 |', '', ''].join('\n'),
    );

    editor.destroy();
  });

  it('is an Extension with the name the plugin key describes', () => {
    expect(TableHandles.name).toBe('tableHandles');
  });
});
