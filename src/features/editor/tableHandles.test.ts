import { Editor, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';
import { tablePosAt } from './tablePos';

const LABELS = { addRow: 'Insert row here', addColumn: 'Insert column here' };

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

function labelled(content: string): Editor {
  return new Editor({ extensions: buildEditorExtensions({ labels: LABELS }), content });
}

/**
 * Puts the caret inside the table's FIRST body cell — row index 1, column
 * index 0 — and returns nothing.
 *
 * Every handle test below then clicks a handle for a DIFFERENT row or column,
 * which is the only way to tell "acted on the handle's row" apart from "acted
 * on the caret's row". The bar this module replaced could only ever do the
 * latter.
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
    const editor = labelled(TABLE_HTML);
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
    const editor = labelled(`<p>before</p>${TABLE_HTML}`);
    editor.commands.setTextSelection(1);

    expect(layer(editor)).toBeNull();

    editor.destroy();
  });

  it('appears when the caret moves into the table, and goes again when it leaves', () => {
    const editor = labelled(`<p>before</p>${TABLE_HTML}`);

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
    const editor = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);

    expect(handles(editor, 'row').map((el) => el.getAttribute('data-index'))).toEqual(['0', '1']);
    expect(handles(editor, 'column').map((el) => el.getAttribute('data-index'))).toEqual([
      '0',
      '1',
      '2',
    ]);

    editor.destroy();
  });

  it('labels every handle with the caller’s own string', () => {
    const editor = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    expect(handleAt(editor, 'row', 0).getAttribute('aria-label')).toBe(LABELS.addRow);
    expect(handleAt(editor, 'column', 0).getAttribute('aria-label')).toBe(LABELS.addColumn);

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
    const editor = labelled(`<blockquote>${TABLE_HTML}</blockquote>`);
    caretInFirstBodyCell(editor);

    const pos = tablePosAt(editor.state);
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('table');
    expect(handles(editor, 'row')).toHaveLength(3);

    editor.destroy();
  });
});

describe('a handle acts on ITS OWN row or column, not the caret’s', () => {
  // This is the whole reason `TableHandles` is more than a restyled bar. The
  // caret sits in row 1 / column 0 in every case below and the handle clicked
  // is always a DIFFERENT index, so the expectation distinguishes the two
  // outcomes rather than merely asserting "something was added":
  //
  //   caret-based `addRowAfter` would put the blank row between `1 | 2` and
  //   `3 | 4`; the row-2 handle puts it at the end.
  //   caret-based `addColumnAfter` would put the blank column between `a` and
  //   `b`; the column-2 handle puts it at the end.
  //
  // Cell padding and the three-dash minimum are the serializer's, per
  // `docs/rulings/tables.md`.
  it('inserts a row after the row the handle names', () => {
    const editor = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, handleAt(editor, 'row', 2));

    expect(result.handled).toBe(true);
    // Without `preventDefault` the caret is placed into the widget and the
    // selection this handler set is lost before the command reads it.
    expect(result.defaultPrevented).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n|     |     |\n\n',
    );

    editor.destroy();
  });

  it('inserts a row after the HEADER when the header handle is clicked', () => {
    const editor = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    mousedownOn(editor, handleAt(editor, 'row', 0));

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n| 3   | 4   |\n\n',
    );

    editor.destroy();
  });

  it('inserts a column after the column the handle names', () => {
    const editor = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, handleAt(editor, 'column', 2));

    expect(result.handled).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   | c   |     |\n| --- | --- | --- | --- |\n| 1   | 2   | 3   |     |\n\n',
    );

    editor.destroy();
  });

  it('inserts a column after the MIDDLE column when its handle is clicked', () => {
    const editor = labelled(WIDE_TABLE_HTML);
    caretInFirstBodyCell(editor);

    mousedownOn(editor, handleAt(editor, 'column', 1));

    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |     | c   |\n| --- | --- | --- | --- |\n| 1   | 2   |     | 3   |\n\n',
    );

    editor.destroy();
  });

  it('ignores a right-click', () => {
    const editor = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const before = serializeMarkdown(editor.getJSON());
    const result = mousedownOn(editor, handleAt(editor, 'row', 2), { button: 2 });

    expect(result.handled).toBe(false);
    expect(serializeMarkdown(editor.getJSON())).toBe(before);

    editor.destroy();
  });

  it('lets a click on the prose fall through to the editor', () => {
    const editor = labelled(TABLE_HTML);
    caretInFirstBodyCell(editor);

    const result = mousedownOn(editor, editor.view.dom);

    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);

    editor.destroy();
  });
});
