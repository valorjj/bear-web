import { Editor } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';
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

  it('finds a match when the character immediately after the tag is masked, with no whitespace between', () => {
    // `isBoundary`'s `ch === MASK` branch, isolated: a tag directly abutting
    // an inline-code span with no space in between. `MASK` alone must count
    // as a boundary, or this — and the general case of a tag beside any
    // masked construct — would never be offered.
    const editor = editorWith('see #wo`code`');
    editor.commands.setTextSelection(8);
    const match = tagAutocompleteMatchAt(editor.state);
    expect(match?.query).toBe('wo');
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

const LABELS = { listLabel: 'Tag' };

function pluginEditorWith(
  markdown: string,
  tagAutocompleteLabels: typeof LABELS | null = LABELS,
  keys: string[] = KEYS,
): Editor {
  const editor = new Editor({
    extensions: buildEditorExtensions({ tagAutocompleteLabels }),
    content: parseMarkdown(markdown),
  });
  if (tagAutocompleteLabels !== null) editor.commands.setTagAutocompleteKeys(keys);
  return editor;
}

function popover(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.bear-tag-autocomplete-popover');
}

function options(editor: Editor): string[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (el) => el.textContent ?? '',
  );
}

function activeOption(editor: Editor): string | null {
  return editor.view.dom.querySelector('[role="option"].is-active')?.textContent ?? null;
}

/** Invokes the plugin's own `handleKeyDown` against the REAL mounted view —
 * `linkAutocomplete.test.ts:47`'s approach, which needs no layout engine,
 * only the plugin actually being registered. */
function keydown(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  return (
    editor.view.someProp('handleKeyDown', (f) => (f(editor.view, event) ? true : undefined)) ===
    true
  );
}

/** Types at the caret through a real command, one character at a time, so
 * the match function is driven off the real document exactly as keystrokes
 * would drive it — and no click is simulated, so jsdom's missing
 * `posAtCoords` is never reached. */
function type(editor: Editor, text: string): void {
  for (const ch of text) editor.commands.insertContent(ch);
}

function markdownOf(editor: Editor): string {
  // `serializeMarkdown` from `./markdown`, not a `storage.markdown` accessor:
  // `RichEditorHandle.getMarkdown` is the app's route and a bare `Editor` has
  // no handle. Add `serializeMarkdown` to this file's `./markdown` import.
  return serializeMarkdown(editor.getJSON());
}

describe('the popover', () => {
  it('opens with the typed text first once a character follows the #', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).not.toBeNull();
    expect(options(editor)[0]).toBe('a');
    expect(activeOption(editor)).toBe('a');
    editor.destroy();
  });

  it('registers no plugin at all without labels', () => {
    const editor = pluginEditorWith('see ', null);
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('closes when a space commits the tag', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).not.toBeNull();
    type(editor, ' ');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('offers tags present in the document but not yet in the index', () => {
    // The index is written by autosave, which Task 1 now HOLDS while the
    // caret is inside a tag — so a tag typed moments ago is not in `keys`,
    // and that is exactly when the user is most likely to type it again.
    const editor = pluginEditorWith('#project/alpha here\n\nsee ', LABELS, []);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, '#project/');
    expect(options(editor)).toContain('project/alpha');
    editor.destroy();
  });

  it('offers a synthesized ancestor of a document tag', () => {
    // `parseTags` indexes only the exact tag; `buildTagTree` is what
    // synthesizes `a` from `a/b`, so the union must do the same.
    const editor = pluginEditorWith('#deep/nested/leaf here\n\nsee ', LABELS, []);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, '#deep/n');
    expect(options(editor)).toContain('deep/nested');
    editor.destroy();
  });
});

describe('the keyboard', () => {
  it('accepts an existing tag with Tab and leaves the popover open on its descendants', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, 'ArrowDown')).toBe(true);
    expect(activeOption(editor)).toBe('a/b');
    expect(keydown(editor, 'Tab')).toBe(true);

    expect(markdownOf(editor)).toContain('#a/b');
    // Descend-and-stay-open: no trailing space is inserted, so the match rule
    // re-evaluates and the list reopens on what lives under the tag.
    expect(popover(editor)).not.toBeNull();
    expect(options(editor)[0]).toBe('a/b');
    editor.destroy();
  });

  it('commits the typed text and closes when Tab lands on row 0', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#new');
    expect(keydown(editor, 'Tab')).toBe(true);
    expect(markdownOf(editor)).toContain('#new');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  /**
   * The assertion most likely to rot, and the reason `Tab` accepts rather
   * than `Enter`: with row 0 pre-selected there is nothing for `Enter` to
   * insert, so intercepting it would only swallow a keystroke that means
   * "new paragraph" everywhere else in the editor.
   *
   * Deviates from the brief's literal `expect(keydown(editor, 'Enter')).toBe(false)`:
   * measured, `someProp('handleKeyDown')` for Enter is `true` in EVERY
   * editor built from `buildEditorExtensions()`, tag autocomplete or no —
   * StarterKit's own base keymap binds Enter to `splitBlock`, which succeeds
   * and returns `true` regardless of this plugin. The brief's assertion is
   * therefore unfalsifiable in the wrong direction: it would fail against a
   * correct implementation too. The real claim — this plugin does not add
   * its OWN interception on top of that — is tested by the document actually
   * splitting, which a swallowed keystroke would prevent.
   */
  it('does not swallow Enter — the editor still splits the block', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    const before = editor.state.doc.childCount;
    keydown(editor, 'Enter');
    expect(editor.state.doc.childCount).toBe(before + 1);
    editor.destroy();
  });

  it('does NOT consume space', () => {
    // Unlike Enter, nothing else in the editor binds space at the keymap
    // level, so the aggregate `someProp` result is a valid check here.
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, ' ')).toBe(false);
    editor.destroy();
  });

  it('dismisses on Escape and stays dismissed while the same tag is edited', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, 'Escape')).toBe(true);
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('reopens on the next document change after a dismissal', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    keydown(editor, 'Escape');
    type(editor, 'b');
    expect(popover(editor)).not.toBeNull();
    editor.destroy();
  });

  it('wraps the active row at both ends', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    const rows = options(editor);
    keydown(editor, 'ArrowUp');
    expect(activeOption(editor)).toBe(rows[rows.length - 1]);
    keydown(editor, 'ArrowDown');
    expect(activeOption(editor)).toBe(rows[0]);
    editor.destroy();
  });

  it('leaves Tab to the list keymap when the popover is closed', () => {
    // `@tiptap/extension-list-keymap` binds Tab to indent a list item. The
    // collision is resolved by the popover's open state alone: closed, our
    // handler falls through and the list keymap's own binding runs.
    //
    // Deviates from the brief's literal `.toBe(false)`: measured, list-keymap's
    // Tab binding SUCCEEDS here even with no `tagAutocomplete` plugin at all,
    // so the aggregate `someProp` result is `true`, not `false` — asserting
    // `false` would fail against a correct implementation. The real claim —
    // that our own handler did not intercept it first — is tested by the
    // indent actually happening.
    const editor = pluginEditorWith('- one\n- two');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    const before = editor.state.doc.firstChild?.childCount;
    expect(keydown(editor, 'Tab')).toBe(true);
    // 'two' nested under 'one' rather than remaining a second top-level item.
    expect(editor.state.doc.firstChild?.childCount).toBe((before ?? 0) - 1);
    editor.destroy();
  });

  it('consumes Tab for a tag typed inside a list item', () => {
    const editor = pluginEditorWith('- one');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    type(editor, ' #a');
    expect(keydown(editor, 'Tab')).toBe(true);
    editor.destroy();
  });
});

describe('accessibility', () => {
  it('mirrors combobox state onto the focused editable host', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    const host = editor.view.dom;
    expect(host.getAttribute('role')).toBe('combobox');
    expect(host.getAttribute('aria-expanded')).toBe('true');
    expect(host.getAttribute('aria-controls')).not.toBeNull();
    const active = host.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(editor.view.dom.querySelector(`#${active}`)?.textContent).toBe('a');
    editor.destroy();
  });

  it('restores the host role when the popover closes', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    type(editor, ' ');
    expect(editor.view.dom.getAttribute('aria-expanded')).toBeNull();
    editor.destroy();
  });
});

describe('the widget key', () => {
  it('rebuilds the list on every keystroke', () => {
    // `WidgetType.eq` matches two widgets sharing a `key` WITHOUT re-invoking
    // `toDOM`, so a key that stayed constant while the same tag is typed
    // would leave a STALE list on screen. The query and the active index are
    // baked into the key for exactly this reason.
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(options(editor)).toContain('bear');
    type(editor, '/');
    expect(options(editor)).not.toContain('bear');
    expect(options(editor)).toContain('a/b');
    editor.destroy();
  });
});

describe('the trailing-node hazard', () => {
  /**
   * `TrailingNode.appendTransaction` runs on EVERY dispatched transaction,
   * not only ones that changed the document, so a meta-only dispatch inserts
   * a spurious trailing paragraph into a note ending in a list — which
   * autosave then persists.
   *
   * The vulnerability flag is computed once at plugin `init` and burned
   * permanently by the FIRST untagged transaction dispatched afterwards,
   * INCLUDING one a test uses only to set up its own fixture. So this fixture
   * reaches the dispatch under test using only TAGGED transactions from the
   * very first one; L2's first version of this test typed its setup and
   * passed with the fix removed.
   */
  function quietlySelect(editor: Editor, pos: number): void {
    const tr = editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, pos))
      .setMeta(skipTrailingNodeMeta, true);
    editor.view.dispatch(tr);
  }

  it('does not append a paragraph when the key list is pushed', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ tagAutocompleteLabels: LABELS }),
      content: parseMarkdown('- one\n- two'),
    });
    const before = markdownOf(editor);

    editor.commands.setTagAutocompleteKeys(KEYS);

    expect(markdownOf(editor)).toBe(before);
    editor.destroy();
  });

  it('does not append a paragraph when the active row moves', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ tagAutocompleteLabels: LABELS }),
      content: parseMarkdown('#a here\n\n- one\n- two'),
    });
    editor.commands.setTagAutocompleteKeys(KEYS);
    quietlySelect(editor, 3);
    const before = markdownOf(editor);

    keydown(editor, 'ArrowDown');
    keydown(editor, 'Escape');

    expect(markdownOf(editor)).toBe(before);
    editor.destroy();
  });
});
