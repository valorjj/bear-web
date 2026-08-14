import { Editor, isMacOS } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { tagDecorations, tagRangeAt } from './TagPill';

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

  it("lifts the pill when the caret sits at the tag's closing edge", () => {
    // The closing edge is what every keystroke of *typing* a tag produces
    // (the caret trails the last character typed so far), and it is what a
    // freshly seeded note's tag-at-end-of-line case reduces to. Only the
    // opening edge was covered before this test.
    const editor = docFor('<p>#work and #home</p>');
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const workIndex = full.indexOf('#work');
    const closingEdge = 1 + workIndex + '#work'.length;
    editor.commands.setTextSelection(closingEdge);
    expect(editor.state.selection.from).toBe(closingEdge);
    expect(editor.state.selection.to).toBe(closingEdge);

    const decorated = decorationsOf(editor).map(({ from, to }) =>
      editor.state.doc.textBetween(from, to),
    );
    expect(decorated).toEqual(['#home']);
    editor.destroy();
  });

  it('does not suppress when the editor is unfocused, even with the caret inside a tag', () => {
    // The rule's entire justification is caret comfort: an unfocused editor
    // has no caret visibly on screen, so there is nothing to protect. A
    // freshly created note is seeded with its scope's tag and opens
    // unfocused with the selection at position 1 — the tag's own opening
    // edge — so without this gate the pill never appeared on open.
    const editor = docFor('<p>#work and #home</p>');
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const workIndex = full.indexOf('#work');
    const insideWork = 1 + workIndex + 3;
    editor.commands.setTextSelection(insideWork);
    expect(editor.state.selection.from).toBe(insideWork);

    const decorated = tagDecorations(editor.state, false).map(({ from, to }) =>
      editor.state.doc.textBetween(from, to),
    );
    expect(decorated).toEqual(['#work', '#home']);
    editor.destroy();
  });
});

describe('tagRangeAt', () => {
  it('finds the tag covering a position inside it', () => {
    const editor = docFor('<p>a #work b</p>');
    // '#work' occupies positions 3..8: paragraph starts at 0, its text at 1,
    // so 'a ' is 1..3 and the '#' is at 3.
    const hit = tagRangeAt(editor.state, 5);
    expect(hit).toEqual({ tag: 'work', from: 3, to: 8 });
    expect(editor.state.doc.textBetween(hit!.from, hit!.to)).toBe('#work');
    editor.destroy();
  });

  it('finds the tag at each of its edges', () => {
    const editor = docFor('<p>a #work b</p>');
    expect(tagRangeAt(editor.state, 3)?.tag).toBe('work');
    expect(tagRangeAt(editor.state, 8)?.tag).toBe('work');
    editor.destroy();
  });

  it('returns null for ordinary prose', () => {
    const editor = docFor('<p>a #work b</p>');
    expect(tagRangeAt(editor.state, 1)).toBeNull();
    expect(tagRangeAt(editor.state, 10)).toBeNull();
    editor.destroy();
  });

  it('returns null inside an inline code span', () => {
    const editor = docFor('<p>a <code>#work</code> b</p>');
    expect(tagRangeAt(editor.state, 5)).toBeNull();
    editor.destroy();
  });

  it('returns null inside a code block', () => {
    const editor = docFor('<pre><code>#work</code></pre>');
    expect(tagRangeAt(editor.state, 3)).toBeNull();
    editor.destroy();
  });

  it('finds a tag in the second of two blocks', () => {
    const editor = docFor('<p>#work</p><p>#home</p>');
    const first = tagRangeAt(editor.state, 2)!;
    const second = tagRangeAt(editor.state, 9)!;
    expect(first.tag).toBe('work');
    expect(second.tag).toBe('home');
    expect(editor.state.doc.textBetween(second.from, second.to)).toBe('#home');
    editor.destroy();
  });

  // The property that makes activation independent of invisible state.
  it('finds a tag whose pill is suppressed by the selection', () => {
    const editor = docFor('<p>a #work b</p>');
    editor.commands.setTextSelection(5);
    expect(tagDecorations(editor.state, true)).toEqual([]);
    expect(tagRangeAt(editor.state, 5)?.tag).toBe('work');
    editor.destroy();
  });

  // The two must agree on extent wherever a pill IS painted — one scan, two
  // callers.
  it('agrees with the decoration a pill would paint', () => {
    const editor = docFor('<p>a #work b</p>');
    const [decoration] = tagDecorations(editor.state, false);
    const hit = tagRangeAt(editor.state, 5)!;
    expect({ from: hit.from, to: hit.to }).toEqual({
      from: decoration!.from,
      to: decoration!.to,
    });
    editor.destroy();
  });
});

describe('mounted plugin (real DOM, not a direct tagDecorations call)', () => {
  // `tagDecorations` is called directly everywhere above. Nothing above
  // proves the registered ProseMirror plugin itself re-renders when only
  // the selection or the focus state changes — and a decoration leaves no
  // trace in the document or its Markdown, so a plugin that silently never
  // reruns looks identical to one that works (the same blind spot this
  // file's header comment already warns about for the plugin's existence).

  it('the rendered .bear-tag spans change on a selection-only transaction', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>#work and #home</p>',
      element: container,
    });
    // Force the focused branch without depending on real DOM focus timing,
    // isolating this test to the selection-only claim.
    editor.isFocused = true;

    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    const workIndex = full.indexOf('#work');
    const insideWork = 1 + workIndex + 2;
    const andIndex = full.indexOf(' and ');
    const neutral = 1 + andIndex + 2;

    editor.commands.setTextSelection(insideWork);
    expect(editor.view.dom.querySelectorAll('.bear-tag')).toHaveLength(1);

    editor.commands.setTextSelection(neutral);
    expect(editor.view.dom.querySelectorAll('.bear-tag')).toHaveLength(2);

    editor.destroy();
  });

  it('the rendered .bear-tag spans change on real DOM focus and blur', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>#work and #home</p>',
      element: container,
    });

    // A fresh, unmounted-into-focus editor: not focused, caret at position
    // 1 (the opening edge of '#work') by default. Unfocused, both tags
    // should be pilled.
    expect(editor.isFocused).toBe(false);
    expect(editor.view.dom.querySelectorAll('.bear-tag')).toHaveLength(2);

    // A real 'focus' DOM event, not a property assignment: this is what
    // exercises Tiptap's own `FocusEvents` extension, which sets
    // `editor.isFocused` and dispatches a transaction — the mechanism this
    // plugin's suppression depends on to ever repaint.
    editor.view.dom.focus();
    expect(editor.isFocused).toBe(true);
    expect(editor.view.dom.querySelectorAll('.bear-tag')).toHaveLength(1);

    editor.view.dom.blur();
    expect(editor.isFocused).toBe(false);
    expect(editor.view.dom.querySelectorAll('.bear-tag')).toHaveLength(2);

    editor.destroy();
  });
});

/**
 * Invokes the plugin's own mousedown handler with a fake view, so the test
 * exercises the real registered plugin without needing jsdom layout —
 * `posAtCoords` has no meaning without a layout engine.
 */
function mousedownAt(
  editor: Editor,
  pos: number,
  init: MouseEventInit,
): { handled: boolean; defaultPrevented: boolean } {
  const event = new MouseEvent('mousedown', { cancelable: true, button: 0, ...init });
  const view = { state: editor.state, posAtCoords: () => ({ pos, inside: pos }) };
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined ? false : handlers.mousedown(view as never, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

describe('tag activation', () => {
  it('reports the tag and swallows the event on a modifier click', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual(['work']);
    expect(result.handled).toBe(true);
    // Preventing the default is what stops the browser moving the caret into
    // the tag, which would lift the pill the user just clicked.
    expect(result.defaultPrevented).toBe(true);
    editor.destroy();
  });

  it('does nothing on a plain click, so the caret still moves', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, {});

    expect(activated).toEqual([]);
    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);
    editor.destroy();
  });

  it('does nothing on a modifier click outside any tag', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 1, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual([]);
    expect(result.handled).toBe(false);
    editor.destroy();
  });

  it('does not activate on a non-primary button', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const modifier = isMacOS() ? { metaKey: true } : { ctrlKey: true };
    expect(mousedownAt(editor, 5, { ...modifier, button: 1 }).handled).toBe(false);
    expect(mousedownAt(editor, 5, { ...modifier, button: 2 }).handled).toBe(false);
    expect(activated).toEqual([]);
    editor.destroy();
  });

  // Ctrl-click on macOS is the context-menu gesture. Getting this wrong is
  // invisible on Linux CI, so it needs its own assertion on both platforms.
  it('treats Ctrl as the modifier only off Apple platforms', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const ctrl = mousedownAt(editor, 5, { ctrlKey: true });
    const meta = mousedownAt(editor, 5, { metaKey: true });

    if (isMacOS()) {
      expect(ctrl.handled).toBe(false);
      expect(meta.handled).toBe(true);
      expect(activated).toEqual(['work']);
    } else {
      expect(ctrl.handled).toBe(true);
      expect(meta.handled).toBe(false);
      expect(activated).toEqual(['work']);
    }
    editor.destroy();
  });

  // Independence from invisible state, end to end through the real plugin.
  it('activates a tag whose pill is currently suppressed', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });
    editor.commands.setTextSelection(5);
    editor.commands.focus();

    mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual(['work']);
    editor.destroy();
  });

  it('is inert when no callback is injected', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(result.handled).toBe(false);
    editor.destroy();
  });

  it('puts the injected hint on every pill', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ activateHint: 'Cmd-click to filter' }),
      content: '<p>#work and #home</p>',
    });

    const titles = tagDecorations(editor.state, false).map(
      // A Decoration's spec is where `Decoration.inline`'s attribute object lands.
      (decoration) =>
        (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs.title,
    );
    expect(titles).toEqual(['Cmd-click to filter', 'Cmd-click to filter']);
    editor.destroy();
  });
});
