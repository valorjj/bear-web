import { Editor, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';
import { TABLE_ACTIONS, tablePosAt, type TableAction } from './TableControls';

const LABELS = {
  toolbar: 'Table',
  addRow: '+ Row',
  deleteRow: '- Row',
  addColumn: '+ Column',
  deleteColumn: '- Column',
  deleteTable: 'Delete table',
};

const TABLE_HTML =
  '<table><tbody>' +
  '<tr><th><p>a</p></th><th><p>b</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
  '</tbody></table>';

function labelled(content: string): Editor {
  return new Editor({ extensions: buildEditorExtensions({ labels: LABELS }), content });
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

function bar(editor: Editor): Element | null {
  return editor.view.dom.querySelector('.bear-table-controls');
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

function buttonFor(editor: Editor, action: TableAction): Element {
  const el = editor.view.dom.querySelector(`[data-table-action="${action}"]`);
  expect(el, `no button for ${action}`).not.toBeNull();
  return el!;
}

describe('the table controls schema contract', () => {
  // Same blind spot `HeadingFold` documents: this is an Extension that
  // decorates and never mutates, so every Markdown round-trip test in the
  // suite passes whether or not the plugin runs at all. Only assertions on
  // the decoration set and on the commands can see it.
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).not.toContain('tableControls');
    expect(Object.keys(schema.marks)).not.toContain('tableControls');
  });

  it('leaves the table byte-identical while the bar is showing', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    expect(bar(editor)).not.toBeNull();
    // Padded cells and a three-dash minimum in the alignment row: that is
    // what this serializer produces, and `docs/rulings/tables.md` says not to
    // tidy the pinned string into something prettier but false. The trailing
    // blank line is `TrailingNode`'s paragraph, not the table's.
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n',
    );

    editor.destroy();
  });
});

describe('tablePosAt', () => {
  it('is null when the selection is not in a table', () => {
    const editor = labelled('<p>plain</p>');
    expect(tablePosAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('resolves the table the selection is inside', () => {
    const editor = labelled(`<p>before</p>${TABLE_HTML}`);
    selectInsideTable(editor);

    const pos = tablePosAt(editor.state);
    expect(pos).not.toBeNull();
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('table');

    editor.destroy();
  });

  // Walks outward from the cursor rather than scanning the document, so a
  // table inside a blockquote resolves to the table and not to an ancestor.
  it('resolves the INNERMOST table when one is nested in a blockquote', () => {
    const editor = labelled(`<blockquote>${TABLE_HTML}</blockquote>`);
    selectInsideTable(editor);

    const pos = tablePosAt(editor.state);
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('table');

    editor.destroy();
  });
});

describe('the table controls bar', () => {
  it('is absent while the cursor is outside a table', () => {
    const editor = labelled(`<p>before</p>${TABLE_HTML}`);
    editor.commands.setTextSelection(1);

    expect(bar(editor)).toBeNull();

    editor.destroy();
  });

  it('appears when the cursor moves into the table, and goes again when it leaves', () => {
    const editor = labelled(`<p>before</p>${TABLE_HTML}`);

    selectInsideTable(editor);
    expect(bar(editor)).not.toBeNull();

    editor.commands.setTextSelection(1);
    expect(bar(editor)).toBeNull();

    editor.destroy();
  });

  it('renders every action, as a named toolbar', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    expect(bar(editor)?.getAttribute('role')).toBe('toolbar');
    expect(bar(editor)?.getAttribute('aria-label')).toBe('Table');
    expect(
      [...editor.view.dom.querySelectorAll('[data-table-action]')].map((el) =>
        el.getAttribute('data-table-action'),
      ),
    ).toEqual([...TABLE_ACTIONS]);

    editor.destroy();
  });

  // Words, not glyphs: three of the five destroy content, and this project's
  // rule is that a destructive control keeps its words.
  it('labels every button with real text from the caller', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    for (const action of TABLE_ACTIONS) {
      expect(buttonFor(editor, action).textContent).toBe(LABELS[action]);
    }

    editor.destroy();
  });

  it('marks the destructive actions, and only those', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    const destructive = TABLE_ACTIONS.filter((action) =>
      buttonFor(editor, action).hasAttribute('data-destructive'),
    );
    expect(destructive).toEqual(['deleteRow', 'deleteColumn', 'deleteTable']);

    editor.destroy();
  });

  // The schema-only `editorExtensions` constant supplies no labels. A bar of
  // five blank buttons would be worse than no bar, and no user-facing string
  // may be hardcoded in this app — so with no labels there is no plugin.
  it('renders nothing at all when the caller supplied no labels', () => {
    const editor = new Editor({ extensions: editorExtensions, content: TABLE_HTML });
    selectInsideTable(editor);

    expect(bar(editor)).toBeNull();

    editor.destroy();
  });
});

describe('the mousedown handler on the table bar', () => {
  // The caret sits in the FIRST BODY CELL throughout, which is what makes
  // each expectation specific rather than merely "something changed":
  // `deleteRow` takes the body row and leaves the header; `addColumn` inserts
  // AFTER column 0, so the new column lands in the middle rather than at the
  // end. Cell padding and the three-dash minimum are the serializer's, per
  // `docs/rulings/tables.md`.
  it.each([
    ['addRow', '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n\n'],
    ['deleteRow', '| a   | b   |\n| --- | --- |\n\n'],
    ['addColumn', '| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n\n'],
    ['deleteColumn', '| b   |\n| --- |\n| 2   |\n\n'],
    ['deleteTable', ''],
  ] as const)('%s changes the document', (action, expected) => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    const result = mousedownOn(editor, buttonFor(editor, action));

    expect(result.handled).toBe(true);
    // Without `preventDefault` the caret is placed into the widget and the
    // editor loses the selection the command needs.
    expect(result.defaultPrevented).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(expected);

    editor.destroy();
  });

  it('ignores a right-click', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    const before = serializeMarkdown(editor.getJSON());
    const result = mousedownOn(editor, buttonFor(editor, 'deleteTable'), { button: 2 });

    expect(result.handled).toBe(false);
    expect(serializeMarkdown(editor.getJSON())).toBe(before);

    editor.destroy();
  });

  it('lets a click on the prose fall through to the editor', () => {
    const editor = labelled(TABLE_HTML);
    selectInsideTable(editor);

    const result = mousedownOn(editor, editor.view.dom);

    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);

    editor.destroy();
  });
});
