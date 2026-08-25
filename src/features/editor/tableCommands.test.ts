import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';
import { COMMANDS, TABLE_ACTIONS, type TableAction } from './tableCommands';

const TABLE_HTML =
  '<table><tbody>' +
  '<tr><th><p>a</p></th><th><p>b</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
  '</tbody></table>';

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

function run(editor: Editor, action: TableAction): boolean {
  return COMMANDS[action](editor.state, editor.view.dispatch);
}

describe('TABLE_ACTIONS', () => {
  it('lists all seven, before then after for both row and column', () => {
    expect(TABLE_ACTIONS).toEqual([
      'addRowBefore',
      'addRowAfter',
      'addColumnBefore',
      'addColumnAfter',
      'deleteRow',
      'deleteColumn',
      'deleteTable',
    ]);
  });
});

describe('COMMANDS', () => {
  // The caret sits in the FIRST BODY CELL throughout, which is what makes
  // each expectation specific rather than merely "something changed":
  // `deleteRow` takes the body row and leaves the header; `addColumnAfter`
  // inserts after column 0, so the new column lands in the MIDDLE rather
  // than at an edge. Cell padding and the three-dash minimum in the
  // alignment row are the serializer's own output, per
  // `docs/rulings/tables.md` — not hand-tidied.
  it.each([
    ['addRowAfter', '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n\n'],
    ['deleteRow', '| a   | b   |\n| --- | --- |\n\n'],
    ['addColumnAfter', '| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n\n'],
    ['deleteColumn', '| b   |\n| --- |\n| 2   |\n\n'],
    ['deleteTable', ''],
  ] as const)('%s changes the document', (action, expected) => {
    const editor = tableEditor();
    selectInsideTable(editor);

    expect(run(editor, action)).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(expected);

    editor.destroy();
  });

  // Obtained by running `addRowBefore` against the caret's first-body-cell
  // position and printing `serializeMarkdown(editor.getJSON())` once, per
  // the brief — not hand-written. The new blank row lands BETWEEN the
  // header and the old body row, which is what distinguishes this from
  // `addRowAfter` above rather than merely asserting "a row appeared".
  it('addRowBefore inserts above the caret row, leaving the header alone', () => {
    const editor = tableEditor();
    selectInsideTable(editor);

    expect(run(editor, 'addRowBefore')).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n\n',
    );

    editor.destroy();
  });

  // Same provenance as above. The new blank column lands FIRST — before
  // column 0, where the caret sits — which is what distinguishes this from
  // `addColumnAfter`'s middle-of-the-table insertion.
  it('addColumnBefore inserts to the left of the caret column', () => {
    const editor = tableEditor();
    selectInsideTable(editor);

    expect(run(editor, 'addColumnBefore')).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      '|     | a   | b   |\n| --- | --- | --- |\n|     | 1   | 2   |\n\n',
    );

    editor.destroy();
  });
});
