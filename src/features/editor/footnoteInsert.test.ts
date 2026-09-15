import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';

const createdEditors: Editor[] = [];

function editorFor(markdown: string): Editor {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
  createdEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()!.destroy();
  }
});

describe('insertFootnote', () => {
  it('inserts a marker and its footnote together', () => {
    const editor = editorFor('Alpha beta.');
    editor.commands.setTextSelection(6);

    editor.commands.insertFootnote();

    // The trailing blank is `TrailingNode`'s paragraph: the document now ends
    // in a footnote, and this was a real edit, so a place to keep typing below
    // is the editor's normal behaviour rather than this command's doing.
    expect(serializeMarkdown(editor.getJSON())).toBe('Alpha[^1] beta.\n\n[^1]: \n\n');
  });

  /**
   * ONE undo, not two. A test that checked only the marker would pass against
   * two transactions, and the writer would then have to undo twice for one
   * gesture.
   */
  it('is a single transaction, so one undo restores both halves', () => {
    const editor = editorFor('Alpha beta.');
    const before = serializeMarkdown(editor.getJSON());
    editor.commands.setTextSelection(6);

    editor.commands.insertFootnote();
    editor.commands.undo();

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
  });

  it('picks the next free numeric label', () => {
    const editor = editorFor('A[^1] B.\n\n[^1]: one');
    editor.commands.setTextSelection(7);

    editor.commands.insertFootnote();

    expect(serializeMarkdown(editor.getJSON())).toContain('[^2]');
  });

  it('skips past the highest label, never re-using a freed one', () => {
    const editor = editorFor('A[^1] B[^3] C.\n\n[^1]: one\n\n[^3]: three');
    editor.commands.setTextSelection(13);

    editor.commands.insertFootnote();

    expect(serializeMarkdown(editor.getJSON())).toContain('[^4]');
  });

  it('ignores word labels when numbering', () => {
    const editor = editorFor('A[^why] B.\n\n[^why]: because');
    editor.commands.setTextSelection(9);

    editor.commands.insertFootnote();

    expect(serializeMarkdown(editor.getJSON())).toContain('[^1]');
  });

  it('puts the caret in the new footnote', () => {
    const editor = editorFor('Alpha beta.');
    editor.commands.setTextSelection(6);

    editor.commands.insertFootnote();
    editor.commands.insertContent('typed');

    expect(serializeMarkdown(editor.getJSON())).toBe('Alpha[^1] beta.\n\n[^1]: typed\n\n');
  });

  it('appends after the last existing footnote', () => {
    const editor = editorFor('A[^1].\n\n[^1]: one');
    editor.commands.setTextSelection(2);

    editor.commands.insertFootnote();

    expect(serializeMarkdown(editor.getJSON())).toBe('A[^2][^1].\n\n[^1]: one\n\n[^2]: \n\n');
  });
});
