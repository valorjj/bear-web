import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { tagDecorations } from './TagPill';

function docFor(content: string): Editor {
  return new Editor({ extensions: editorExtensions, content });
}

/** The decorations this plugin would produce for the given state. */
function decorationsOf(editor: Editor): Array<{ from: number; to: number }> {
  return tagDecorations(editor.state).map((d) => ({ from: d.from, to: d.to }));
}

describe('tag pill decorations', () => {
  it('decorates a tag in a paragraph', () => {
    const editor = docFor('<p>a #work b</p>');
    const decorations = decorationsOf(editor);
    expect(decorations).toHaveLength(1);
    const [{ from, to }] = decorations;
    expect(editor.state.doc.textBetween(from!, to!)).toBe('#work');
    editor.destroy();
  });

  it('decorates every occurrence, including a repeat', () => {
    const editor = docFor('<p>#work then #work</p>');
    expect(decorationsOf(editor)).toHaveLength(2);
    editor.destroy();
  });

  it('decorates tags in more than one block', () => {
    const editor = docFor('<p>#work</p><p>#home</p>');
    expect(decorationsOf(editor)).toHaveLength(2);
    editor.destroy();
  });

  it('does not decorate inside an inline code span', () => {
    const editor = docFor('<p>a <code>#work</code> b</p>');
    expect(decorationsOf(editor)).toEqual([]);
    editor.destroy();
  });

  it('does not decorate inside a code block', () => {
    const editor = docFor('<pre><code>#work</code></pre>');
    expect(decorationsOf(editor)).toEqual([]);
    editor.destroy();
  });

  it('does not treat a heading marker as a tag', () => {
    const editor = docFor('<h1>Heading</h1>');
    expect(decorationsOf(editor)).toEqual([]);
    editor.destroy();
  });

  // The position arithmetic is the whole risk, and `textBetween` cannot pin
  // it here: a hardBreak is a leaf that contributes zero characters to
  // `textBetween`, so a `from` shifted onto the break's own position reads
  // back identically to the correct `from` — `textBetween` cannot tell the
  // two apart. Asserting the integers directly is what actually pins the
  // arithmetic: the paragraph opens at doc position 0, so its content starts
  // at 1; `a` occupies position 1, the hardBreak (a one-position leaf)
  // occupies position 2, and `#work` therefore starts at 3 and runs 5
  // characters to 8.
  it('decorates exactly the tag text after a hard break', () => {
    const editor = docFor('<p>a<br>#work</p>');
    const [{ from, to }] = decorationsOf(editor);
    expect(from).toBe(3);
    expect(to).toBe(8);
    expect(editor.state.doc.textBetween(from!, to!)).toBe('#work');
    editor.destroy();
  });
});
