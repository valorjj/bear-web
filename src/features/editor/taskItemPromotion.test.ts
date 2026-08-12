import { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { editorExtensions } from './extensions';
import { serializeMarkdown } from './markdown';

// jsdom has no layout engine, so ProseMirror's caret/scroll math throws on
// APIs jsdom never implements. An input rule that toggles a block-level node
// dispatches a transaction with `scrollIntoView()`, which reaches
// `EditorView.scrollToSelection` and, through it, `Range.getClientRects`.
// Without these stubs the error is UNCAUGHT and `vitest run` exits 1 even
// when every assertion passes. Same documented gap as
// `NoteEditor.test.tsx`'s three stubs and `toolbars.test.tsx`'s
// `scrollToSelection` spy; `scrollToSelection` only moves the viewport, never
// the document, so stubbing it cannot mask a document defect — and these
// tests assert on the document.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
Range.prototype.getBoundingClientRect = () => emptyRect;
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

// prosemirror-view's published types mark `scrollToSelection` internal, so the
// prototype must be cast to spy on it.
const editorViewPrototype = EditorView.prototype as unknown as { scrollToSelection: () => void };
let scrollToSelectionSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  scrollToSelectionSpy = vi
    .spyOn(editorViewPrototype, 'scrollToSelection')
    .mockImplementation(() => undefined);
});

afterAll(() => {
  scrollToSelectionSpy.mockRestore();
});

function editorWith(content: string): Editor {
  return new Editor({ extensions: editorExtensions, content });
}

/**
 * Types `text` one character at a time through the same path a real keypress
 * takes: offer the character to `handleTextInput` (which is where the input
 * rules plugin lives) and, only if no rule claimed it, insert it. Driving
 * `handleTextInput` alone would never put `[`, ` ` or `]` into the document,
 * so no rule anchored on the text *before* the caret could ever match.
 */
function type(editor: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const deflt = (): Transaction => editor.state.tr.insertText(ch, from, to);
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, ch, deflt),
    );
    if (handled !== true) editor.view.dispatch(deflt());
  }
}

/** The shape of `editor.getJSON()` this suite actually reads. */
type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
};

function topLevelNodes(editor: Editor): JsonNode[] {
  return ((editor.getJSON() as JsonNode).content ?? []) as JsonNode[];
}

/** Position inside the first empty text block in the document. */
function firstEmptyTextBlockPos(editor: Editor): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (node.isTextblock && node.content.size === 0) found = pos + 1;
    return found === undefined;
  });
  if (found === undefined) throw new Error('no empty text block in document');
  return found;
}

describe('bullet-to-task promotion', () => {
  it('promotes an empty bullet item when "[ ] " is typed', () => {
    const editor = editorWith('<ul><li><p></p></li></ul>');
    editor.commands.focus('end');
    type(editor, '[ ] ');

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('taskItem');
    expect(json).not.toContain('[ ]');
    editor.destroy();
  });

  it('records the checked state from "[x] "', () => {
    const editor = editorWith('<ul><li><p></p></li></ul>');
    editor.commands.focus('end');
    type(editor, '[x] ');

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('taskItem');
    expect(json).toContain('"checked":true');
    editor.destroy();
  });

  it('leaves the unchecked state on "[ ] "', () => {
    const editor = editorWith('<ul><li><p></p></li></ul>');
    editor.commands.focus('end');
    type(editor, '[ ] ');

    expect(JSON.stringify(editor.getJSON())).toContain('"checked":false');
    editor.destroy();
  });

  // A taskItem may only live in a taskList, so promotion has to split the
  // surrounding bulletList. The untouched items must survive as bullets.
  it('leaves the neighbouring bullet items alone', () => {
    const editor = editorWith('<ul><li><p>one</p></li><li><p></p></li><li><p>three</p></li></ul>');
    editor.commands.setTextSelection(firstEmptyTextBlockPos(editor));
    // Prove the caret really is in the empty middle item before typing,
    // rather than trusting a literal offset.
    expect(editor.state.selection.$from.parent.textContent).toBe('');
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem');
    type(editor, '[ ] ');

    // Structural, not serialized: the list must have been SPLIT, with the two
    // untouched items still bullets in their own bulletLists. A markdown-only
    // assertion cannot tell a split from a wholesale conversion of all three.
    const blocks = topLevelNodes(editor);
    expect(blocks.slice(0, 3).map((node) => node.type)).toEqual([
      'bulletList',
      'taskList',
      'bulletList',
    ]);
    expect(JSON.stringify(blocks[0])).toContain('"text":"one"');
    expect(JSON.stringify(blocks[2])).toContain('"text":"three"');
    expect(JSON.stringify(blocks[0])).not.toContain('taskItem');
    expect(JSON.stringify(blocks[2])).not.toContain('taskItem');

    const markdown = serializeMarkdown(editor.getJSON());
    expect(markdown).toContain('- one');
    expect(markdown).toContain('- three');
    expect(markdown).toContain('- [ ]');
    editor.destroy();
  });

  // The defect exactly as reported: nothing pre-built, just the keystrokes.
  it('turns the typed sequence "- [ ] milk" into a task item', () => {
    const editor = editorWith('<p></p>');
    editor.commands.focus('end');
    type(editor, '- [ ] milk');

    const taskList = topLevelNodes(editor)[0];
    expect(taskList?.type).toBe('taskList');
    const taskItem = taskList?.content?.[0];
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs?.checked).toBe(false);
    expect(JSON.stringify(taskItem)).toContain('"text":"milk"');
    expect(JSON.stringify(editor.getJSON())).not.toContain('[ ]');
    editor.destroy();
  });

  it('accepts an uppercase "[X] " as checked', () => {
    const editor = editorWith('<p></p>');
    editor.commands.focus('end');
    type(editor, '- [X] milk');

    const taskItem = topLevelNodes(editor)[0]?.content?.[0];
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs?.checked).toBe(true);
    editor.destroy();
  });

  // Pinned behaviour, not an endorsement: `toggleTaskList()` lifts a nested
  // bullet item out to the top level as it promotes it, so `  - [ ] sub`
  // under `- a` loses its indentation. That is still better than the defect
  // (a literal `[ ] sub` bullet), and the parent item survives untouched —
  // but it is a structural rewrite, so it is asserted here rather than left
  // to be discovered. Changing it must be a deliberate edit to this test.
  it('promotes a nested bullet item, lifting it to the top level', () => {
    const editor = editorWith('<ul><li><p>a</p><ul><li><p></p></li></ul></li></ul>');
    editor.commands.setTextSelection(firstEmptyTextBlockPos(editor));
    type(editor, '[ ] sub');

    const blocks = topLevelNodes(editor);
    expect(blocks.slice(0, 2).map((node) => node.type)).toEqual(['bulletList', 'taskList']);
    expect(JSON.stringify(blocks[0])).toContain('"text":"a"');
    editor.destroy();
  });

  // Pinned behaviour, not an endorsement, and the sharper case of the lift
  // above: a bullet inside a blockquote leaves the blockquote entirely when
  // promoted. `TaskItem`'s OWN rule does not do this — from
  // `<blockquote><p></p></blockquote>` it produces
  // `blockquote > taskList > taskItem`, keeping the quote (asserted below, so
  // the difference is a fact this suite checks rather than a claim). So this
  // rule rewrites containment in a way the existing one does not. Accepted on
  // the same grounds as the nested-list lift — nothing is lost, the quoted
  // paragraph survives, and it beats the literal-text defect — but pinned so
  // it is visible rather than discovered.
  it('lifts a bullet out of a blockquote when promoting it', () => {
    const editor = editorWith('<blockquote><p>quoted</p><ul><li><p></p></li></ul></blockquote>');
    editor.commands.setTextSelection(firstEmptyTextBlockPos(editor));
    type(editor, '[ ] q');

    const blocks = topLevelNodes(editor);
    expect(blocks.slice(0, 2).map((node) => node.type)).toEqual(['blockquote', 'taskList']);
    // The quoted paragraph survives, and the task item is NOT inside the quote.
    expect(JSON.stringify(blocks[0])).toContain('"text":"quoted"');
    expect(JSON.stringify(blocks[0])).not.toContain('taskItem');
    expect(JSON.stringify(blocks[1])).toContain('"text":"q"');
    editor.destroy();
  });

  // The contrast that makes the test above a real difference and not just a
  // quirk of blockquotes: TaskItem's own rule keeps the blockquote.
  it("keeps the blockquote when TaskItem's own rule promotes a paragraph", () => {
    const editor = editorWith('<blockquote><p></p></blockquote>');
    editor.commands.setTextSelection(firstEmptyTextBlockPos(editor));
    type(editor, '[ ] q');

    const quote = topLevelNodes(editor)[0];
    expect(quote?.type).toBe('blockquote');
    expect(quote?.content?.[0]?.type).toBe('taskList');
    expect(JSON.stringify(quote)).toContain('"text":"q"');
    editor.destroy();
  });

  // `TaskItem`'s own rule accepts empty brackets, so this one must too.
  // Otherwise the identical keystrokes give a task item in a paragraph and
  // literal `[] milk` in a bullet, decided by context the user cannot see.
  it("accepts empty brackets, matching TaskItem's own rule", () => {
    const inBullet = editorWith('<p></p>');
    inBullet.commands.focus('end');
    type(inBullet, '- [] milk');
    const promoted = topLevelNodes(inBullet)[0];
    expect(promoted?.type).toBe('taskList');
    expect(promoted?.content?.[0]?.attrs?.checked).toBe(false);
    expect(JSON.stringify(inBullet.getJSON())).not.toContain('[]');
    inBullet.destroy();

    // The plain-paragraph path it now agrees with.
    const inParagraph = editorWith('<p></p>');
    inParagraph.commands.focus('end');
    type(inParagraph, '[] milk');
    expect(topLevelNodes(inParagraph)[0]?.type).toBe('taskList');
    inParagraph.destroy();
  });

  // A `taskItem` may only live in a `taskList`, so promoting inside an ordered
  // list would have to change the list's type. The rule declines instead: the
  // text stays literal, exactly as it did before this rule existed. No
  // corruption either way; recorded so the omission is visible.
  it('does not fire inside an ordered list', () => {
    const editor = editorWith('<p></p>');
    editor.commands.focus('end');
    type(editor, '1. [ ] milk');

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('orderedList');
    expect(json).not.toContain('taskItem');
    expect(json).toContain('[ ] milk');
    editor.destroy();
  });

  it('does not fire mid-paragraph', () => {
    const editor = editorWith('<ul><li><p>milk</p></li></ul>');
    editor.commands.focus('end');
    type(editor, '[ ] ');

    expect(JSON.stringify(editor.getJSON())).not.toContain('taskItem');
    editor.destroy();
  });

  // TaskItem's own rule already handles this and must keep working.
  it('still lets a plain paragraph become a task item', () => {
    const editor = editorWith('<p></p>');
    editor.commands.focus('end');
    type(editor, '[ ] ');

    expect(JSON.stringify(editor.getJSON())).toContain('taskItem');
    editor.destroy();
  });
});
