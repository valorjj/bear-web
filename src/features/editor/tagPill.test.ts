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

  // The position arithmetic is the whole risk. This asserts the decorated
  // span really is the tag text, not an off-by-N neighbour.
  it('decorates exactly the tag text after a hard break', () => {
    const editor = docFor('<p>a<br>#work</p>');
    const [{ from, to }] = decorationsOf(editor);
    expect(editor.state.doc.textBetween(from!, to!)).toBe('#work');
    editor.destroy();
  });
});
