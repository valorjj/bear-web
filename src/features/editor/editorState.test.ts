import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_FLAGS, editorFlagsSelector } from './editorState';
import { editorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

// Every test constructs a fresh editor through this shared helper and never
// destroys it directly; an undestroyed `Editor` leaves ProseMirror's
// `DOMObserver` polling on a `setTimeout` that outlives the test file's jsdom
// environment, throwing "document is not defined" into an uncaught exception
// once that environment tears down (see CLAUDE.md's jsdom toolchain note).
// Tracking every instance here and destroying them all in `afterEach` fixes
// that without touching each test's body.
const createdEditors: Editor[] = [];

function editorWith(markdown: string): Editor {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
  createdEditors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of createdEditors.splice(0)) {
    editor.destroy();
  }
});

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

  it('reports the heading level under the caret, and heading1 in step with it', () => {
    const editor = editorWith('# one\n\nplain');
    editor.commands.setTextSelection(2);

    const flags = editorFlagsSelector({ editor });
    expect(flags.headingLevel).toBe(1);
    expect(flags.heading1).toBe(true);
  });

  it('reports a non-H1 heading level, with heading1 false', () => {
    const editor = editorWith('### three\n\nplain');
    editor.commands.setTextSelection(2);

    const flags = editorFlagsSelector({ editor });
    expect(flags.headingLevel).toBe(3);
    expect(flags.heading1).toBe(false);
  });

  it('reports a null heading level outside a heading', () => {
    const editor = editorWith('# one\n\nplain');
    // "plain" sits in the second block; find its position past the heading.
    const paragraphPos = editor.state.doc.content.size - 2;
    editor.commands.setTextSelection(paragraphPos);

    expect(editorFlagsSelector({ editor }).headingLevel).toBeNull();
  });

  it('EMPTY_FLAGS has every boolean false and every nullable null', () => {
    expect(EMPTY_FLAGS.bold).toBe(false);
    expect(EMPTY_FLAGS.table).toBe(false);
    expect(EMPTY_FLAGS.headingLevel).toBeNull();
    expect(EMPTY_FLAGS.highlightColor).toBeNull();
    expect(EMPTY_FLAGS.highlightRange).toBeNull();
  });
});
