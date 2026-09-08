import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { parseMarkdown } from './markdown';
import { matchingTags, tagAutocompleteMatchAt } from './TagAutocomplete';

const KEYS = ['a', 'a/b', 'a/c', 'bear', 'bear/welcome', 'work', 'assets/sap'];

function editorWith(markdown: string): Editor {
  return new Editor({
    extensions: buildEditorExtensions(),
    content: parseMarkdown(markdown),
  });
}

/** The caret one character before the document's end, i.e. at the end of the
 * text — `doc.content.size` itself is past the closing token of the block. */
function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

describe('tagAutocompleteMatchAt', () => {
  it('finds the tag being typed before the caret', () => {
    const editor = editorWith('see #wo');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)?.query).toBe('wo');
    editor.destroy();
  });

  it('is null with no # before the caret', () => {
    const editor = editorWith('just text');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null on a bare # with nothing typed after it', () => {
    // Keeps the popover out of the way of the `# ` heading input rule, and
    // stops an eight-row list flashing whenever someone starts a heading.
    const editor = editorWith('see #');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null with the caret mid-tag, where no boundary follows', () => {
    // `#wo|rk` — accepting here would replace `#wo` and strand `rk`.
    const editor = editorWith('see #work');
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('accepts the caret at the tag end when whitespace follows', () => {
    const editor = editorWith('see #wo more');
    editor.commands.setTextSelection(editor.state.doc.content.size - 6);
    expect(tagAutocompleteMatchAt(editor.state)?.query).toBe('wo');
    editor.destroy();
  });

  it('is null once a space has been typed inside the query', () => {
    // The multi-word form `#a b#` is out of scope BY CONSTRUCTION: whitespace
    // is a boundary, so the popover closes the moment a space arrives.
    const editor = editorWith('see #a b');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null inside inline code', () => {
    // `maskedBlockText` replaces a code span's characters with MASK, so a
    // literal `#work` typed inside backticks cannot open the list.
    const editor = editorWith('see `#wo`');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null when the # does not start a tag', () => {
    // `canStart` in the real parser: a tag begins at the block start or after
    // whitespace, never mid-word.
    const editor = editorWith('see a#wo');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null when the query cannot normalize to a tag', () => {
    const editor = editorWith('see #.');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null in a code block', () => {
    const editor = editorWith('```\n#wo\n```');
    editor.commands.setTextSelection(5);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('reports positions spanning the # through the caret', () => {
    const editor = editorWith('see #wo');
    caretAtEnd(editor);
    const match = tagAutocompleteMatchAt(editor.state);
    // 'see ' is 4 characters, and a paragraph's first text position is 1.
    expect(match?.from).toBe(5);
    expect(match?.to).toBe(8);
    editor.destroy();
  });
});

describe('matchingTags', () => {
  it('puts the typed text first, always', () => {
    // Substring matching means the highest-ranked EXISTING tag is routinely
    // unrelated to what is being typed (`#a` matches `bear`), so accepting
    // row 0 must be the safe default rather than a rewrite.
    expect(matchingTags(KEYS, 'a')[0]).toBe('a');
    expect(matchingTags(KEYS, 'zzz')).toEqual(['zzz']);
  });

  it('offers descendants of the tag just accepted', () => {
    expect(matchingTags(KEYS, 'a/')).toEqual(['a/', 'a/b', 'a/c']);
  });

  it('ranks prefix matches before substring matches', () => {
    expect(matchingTags(KEYS, 'a')).toEqual([
      'a',
      'a/b',
      'a/c',
      'assets/sap',
      'bear',
      'bear/welcome',
    ]);
  });

  it('dedupes an exact existing tag into row 0', () => {
    const rows = matchingTags(KEYS, 'work');
    expect(rows).toEqual(['work']);
    expect(rows.filter((row) => row === 'work')).toHaveLength(1);
  });

  it('matches case-insensitively while keeping the typed text in row 0', () => {
    // Row 0 stands for the tag the text will produce: `#Work` indexes as
    // `work`, so the existing `work` dedupes into it.
    expect(matchingTags(KEYS, 'Work')).toEqual(['Work']);
    expect(matchingTags(KEYS, 'BEA')).toEqual(['BEA', 'bear', 'bear/welcome']);
  });

  it('caps the list at MAX_RESULTS', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t/${i}`);
    expect(matchingTags(many, 't')).toHaveLength(8);
  });

  it('returns only the query when it cannot normalize', () => {
    expect(matchingTags(KEYS, '.')).toEqual(['.']);
  });
});
