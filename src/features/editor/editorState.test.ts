import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { EMPTY_FLAGS, editorFlagsSelector } from './editorState';
import { editorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

function editorWith(markdown: string): Editor {
  return new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
}

describe('editorFlagsSelector', () => {
  it('reports bold when the caret sits inside a bold run', () => {
    const editor = editorWith('plain **bold** plain');
    // "plain " is 6 characters; position 1 is the start of the paragraph's
    // content, so position 9 is inside "bold".
    editor.commands.setTextSelection(9);

    expect(editorFlagsSelector({ editor }).bold).toBe(true);
  });

  it('reports no bold when the caret sits outside it', () => {
    const editor = editorWith('plain **bold** plain');
    editor.commands.setTextSelection(2);

    expect(editorFlagsSelector({ editor }).bold).toBe(false);
  });

  it('reports the highlight colour under the caret', () => {
    const editor = editorWith('a <mark class="hl-green">green</mark> b');
    editor.commands.setTextSelection(4);

    const flags = editorFlagsSelector({ editor });
    expect(flags.highlight).toBe(true);
    expect(flags.highlightColor).toBe('green');
  });

  it('reports null colour for the default tint, distinct from no highlight', () => {
    const editor = editorWith('a ==plain== b');
    editor.commands.setTextSelection(4);

    const flags = editorFlagsSelector({ editor });
    expect(flags.highlight).toBe(true);
    expect(flags.highlightColor).toBeNull();
  });

  it('reports the highlight range so the palette can anchor to it', () => {
    const editor = editorWith('ab ==hl== cd');
    editor.commands.setTextSelection(5);

    const range = editorFlagsSelector({ editor }).highlightRange;
    expect(range).not.toBeNull();
    // The mark covers exactly "hl": two characters.
    expect(range!.to - range!.from).toBe(2);
  });

  it('reports a null range when no highlight is active', () => {
    const editor = editorWith('nothing here');
    editor.commands.setTextSelection(2);

    expect(editorFlagsSelector({ editor }).highlightRange).toBeNull();
  });

  it('reports table when the caret is inside one and not otherwise', () => {
    const editor = editorWith('| a | b |\n| --- | --- |\n| c | d |');
    editor.commands.setTextSelection(8);
    expect(editorFlagsSelector({ editor }).table).toBe(true);
  });

  it('EMPTY_FLAGS has every boolean false and every nullable null', () => {
    expect(EMPTY_FLAGS.bold).toBe(false);
    expect(EMPTY_FLAGS.table).toBe(false);
    expect(EMPTY_FLAGS.highlightColor).toBeNull();
    expect(EMPTY_FLAGS.highlightRange).toBeNull();
  });
});
