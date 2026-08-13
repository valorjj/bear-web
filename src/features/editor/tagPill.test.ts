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
    // Task 4 added cursor-based suppression. Mounting with no explicit
    // selection parks the cursor at the first valid text position (1),
    // which is the edge of this fixture's first '#work' and would
    // otherwise suppress it — this test is about occurrence counting, not
    // cursor suppression, so move the cursor into neutral territory
    // ("then") first.
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const neutral = 1 + full.indexOf('then') + 2;
    editor.commands.setTextSelection(neutral);
    expect(decorationsOf(editor)).toHaveLength(2);
    editor.destroy();
  });

  it('decorates tags in more than one block', () => {
    const editor = docFor('<p>#work</p><p>#home</p>');
    // Same cursor-parks-on-a-tag issue as above: the default selection sits
    // at position 1, the edge of '#work' in the first paragraph. Move the
    // cursor to the boundary between the two paragraphs, which touches
    // neither tag.
    const boundary = editor.state.doc.firstChild!.nodeSize;
    editor.commands.setTextSelection(boundary);
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

describe('cursor suppression', () => {
  it('lifts the pill on the tag the cursor is inside', () => {
    const editor = docFor('<p>#work and #home</p>');
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const workIndex = full.indexOf('#work');
    expect(workIndex).not.toBe(-1);

    // A single-paragraph doc opens at 0, so its content starts at position 1:
    // a text-string index i sits at doc position 1 + i. Land the caret three
    // characters into '#work' (between 'o' and 'r').
    const target = 1 + workIndex + 3;
    editor.commands.setTextSelection(target);

    // Confirm the caret actually landed where this test's name claims,
    // rather than trusting the arithmetic above.
    const { from: caretFrom, to: caretTo } = editor.state.selection;
    expect(caretFrom).toBe(target);
    expect(caretTo).toBe(target);
    expect(caretFrom).toBeGreaterThan(1 + workIndex);
    expect(caretFrom).toBeLessThan(1 + workIndex + '#work'.length);

    const decorated = decorationsOf(editor).map(({ from, to }) =>
      editor.state.doc.textBetween(from, to),
    );
    expect(decorated).toEqual(['#home']);
    editor.destroy();
  });

  it('restores the pill once the cursor leaves', () => {
    const editor = docFor('<p>#work and #home</p>');
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const workIndex = full.indexOf('#work');
    const insideWork = 1 + workIndex + 2;
    editor.commands.setTextSelection(insideWork);
    expect(editor.state.selection.from).toBe(insideWork);
    expect(decorationsOf(editor)).toHaveLength(1);

    // Move to neutral territory in " and ", away from both tags. The
    // absolute end of the document is NOT a safe "cursor has left" position
    // here: '#home' is the last thing in the paragraph, so the document's
    // final text position sits exactly on its closing edge, which the
    // intersection rule (deliberately) still treats as inside that tag.
    const andIndex = full.indexOf(' and ');
    expect(andIndex).not.toBe(-1);
    const neutral = 1 + andIndex + 2;
    editor.commands.setTextSelection(neutral);
    expect(editor.state.selection.from).toBe(neutral);
    expect(decorationsOf(editor)).toHaveLength(2);
    editor.destroy();
  });

  it('lifts the pill when a selection merely touches the tag', () => {
    const editor = docFor('<p>#work and #home</p>');
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const homeIndex = full.indexOf('#home');
    expect(homeIndex).not.toBe(-1);
    const tagStart = 1 + homeIndex;

    // A selection ending exactly at the tag's opening position: touches the
    // boundary without entering the tag's own characters. (`tagStart - 1`
    // is a valid text position here because '#home' is preceded by a space,
    // unlike '#work', which opens the paragraph — position 0 there is a
    // node-level boundary, not a text position, and setTextSelection would
    // clamp it forward into the tag itself.)
    editor.commands.setTextSelection({ from: tagStart - 1, to: tagStart });
    expect(editor.state.selection.from).toBe(tagStart - 1);
    expect(editor.state.selection.to).toBe(tagStart);

    const decorated = decorationsOf(editor).map(({ from, to }) =>
      editor.state.doc.textBetween(from, to),
    );
    expect(decorated).toEqual(['#work']);
    editor.destroy();
  });
});
