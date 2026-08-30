import { Editor, getSchema } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { linkAutocompleteKey, linkAutocompleteMatchAt, matchingTitles } from './LinkAutocomplete';
import { parseMarkdown } from './markdown';

const LABELS = {
  listLabel: 'Link to note',
  empty: 'No matching note',
};

const TITLES = ['Deploy Checklist', 'Design Review', 'Design Notes', 'Weekly Standup'];

function editorWith(
  markdown: string,
  linkAutocompleteLabels: typeof LABELS | null = LABELS,
  titles: string[] = TITLES,
): Editor {
  const editor = new Editor({
    extensions: buildEditorExtensions({ linkAutocompleteLabels }),
    content: parseMarkdown(markdown),
  });
  if (linkAutocompleteLabels !== null) editor.commands.setLinkAutocompleteTitles(titles);
  return editor;
}

function popover(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.bear-link-autocomplete-popover');
}

function options(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>('[role="option"]')];
}

function activeOption(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('[role="option"].is-active');
}

function emptyState(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.bear-link-autocomplete-empty');
}

/**
 * Invokes the plugin's own `handleKeyDown` prop against the REAL mounted
 * view — the same `editor.view.someProp` approach `HeadingFold.test.ts`
 * uses for its own `handleKeyDown`, and for the same reason
 * `codeLanguageControls.test.ts`'s `fireOn` uses `handleDOMEvents`: this
 * needs no layout engine, only the plugin actually being registered.
 */
function keydown(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  return (
    editor.view.someProp('handleKeyDown', (f) => (f(editor.view, event) ? true : undefined)) ===
    true
  );
}

/** Types `text` at the caret via a real command, one call per character —
 * this drives `linkAutocompleteMatchAt` off the real document exactly as a
 * user's keystrokes would, with none of jsdom's caret/layout gaps: no click
 * is ever simulated, so none of `coordsAtPos`/`posAtCoords` is reached. */
function type(editor: Editor, text: string): void {
  for (const ch of text) editor.commands.insertContent(ch);
}

describe('linkAutocompleteMatchAt', () => {
  it('is null with no unclosed [[', () => {
    const editor = editorWith('just text');
    editor.commands.setTextSelection(6);
    expect(linkAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('finds an unclosed [[query immediately before the caret', () => {
    const editor = editorWith('see [[Depl');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const match = linkAutocompleteMatchAt(editor.state);
    expect(match?.query).toBe('Depl');
    editor.destroy();
  });

  it('is null once the link has been closed', () => {
    const editor = editorWith('[[Deploy Checklist]] and more');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(linkAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null inside a code block', () => {
    const editor = editorWith('```\nsome code\n```');
    let pos: number | null = null;
    editor.state.doc.descendants((node, at) => {
      if (pos === null && node.type.name === 'codeBlock') pos = at + 1;
      return pos === null;
    });
    expect(pos).not.toBeNull();
    editor.commands.setTextSelection(pos!);
    type(editor, '[[x');
    expect(linkAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });
});

describe('matchingTitles', () => {
  it('prefers prefix matches over substring-only matches, capped at 8', () => {
    const titles = Array.from({ length: 12 }, (_, i) => `zz item ${i}`);
    titles.splice(3, 0, 'itemized note');
    const result = matchingTitles(titles, 'item');
    expect(result[0]).toBe('itemized note');
    expect(result).toHaveLength(8);
  });

  it('is case-insensitive substring matching, never fuzzy', () => {
    expect(matchingTitles(TITLES, 'design')).toEqual(['Design Review', 'Design Notes']);
    expect(matchingTitles(TITLES, 'checklist')).toEqual(['Deploy Checklist']);
    expect(matchingTitles(TITLES, 'xyz')).toEqual([]);
  });
});

describe('the schema contract', () => {
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);
    expect(Object.keys(schema.nodes)).not.toContain('linkAutocomplete');
    expect(Object.keys(schema.marks)).not.toContain('linkAutocomplete');
  });

  it('renders nothing at all when the caller supplied no labels', () => {
    const editor = editorWith('', null);
    type(editor, '[[');
    expect(popover(editor)).toBeNull();
    const plugins = editor.state.plugins.filter((p) => p.spec.key === linkAutocompleteKey);
    expect(plugins).toHaveLength(0);
    editor.destroy();
  });
});

describe('the popover', () => {
  it('opens the moment [[ is typed, listing titles up to the cap', () => {
    const editor = editorWith('');
    type(editor, '[[');
    expect(popover(editor)).not.toBeNull();
    expect(options(editor)).toHaveLength(TITLES.length);
    editor.destroy();
  });

  it('filters to titles containing the typed text', () => {
    const editor = editorWith('');
    type(editor, '[[design');
    const labels = options(editor).map((el) => el.textContent);
    expect(labels).toEqual(['Design Review', 'Design Notes']);
    editor.destroy();
  });

  it('caps the list at 8 rows', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Note ${i}`);
    const editor = editorWith('', LABELS, many);
    type(editor, '[[');
    expect(options(editor)).toHaveLength(8);
    editor.destroy();
  });

  it('shows the empty state when nothing matches', () => {
    const editor = editorWith('');
    type(editor, '[[zzzzz');
    expect(options(editor)).toHaveLength(0);
    expect(emptyState(editor)?.textContent).toBe('No matching note');
    editor.destroy();
  });

  it('does NOT open inside a code block', () => {
    const editor = editorWith('```\ncode\n```');
    let pos: number | null = null;
    editor.state.doc.descendants((node, at) => {
      if (pos === null && node.type.name === 'codeBlock') pos = at + 1;
      return pos === null;
    });
    editor.commands.setTextSelection(pos!);
    type(editor, '[[design');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });
});

describe('keyboard interaction', () => {
  it('Enter inserts the exact stored title, not the typed filter text', () => {
    const editor = editorWith('');
    // Deliberately differs in case AND spacing from the stored title
    // ("Deploy Checklist"), so an implementation that inserted the typed
    // text verbatim would fail this the same way an implementation that
    // normalized case would.
    type(editor, '[[deploy   checklist');
    expect(keydown(editor, 'Enter')).toBe(true);
    expect(editor.getText()).toBe('[[Deploy Checklist]]');
    editor.destroy();
  });

  it('ArrowDown moves the active row, and Enter inserts THAT row', () => {
    const editor = editorWith('');
    type(editor, '[[design');
    expect(activeOption(editor)?.textContent).toBe('Design Review');
    expect(keydown(editor, 'ArrowDown')).toBe(true);
    expect(activeOption(editor)?.textContent).toBe('Design Notes');
    expect(keydown(editor, 'Enter')).toBe(true);
    expect(editor.getText()).toBe('[[Design Notes]]');
    editor.destroy();
  });

  it('Escape closes the list and leaves the literal text alone', () => {
    const editor = editorWith('');
    type(editor, '[[deploy');
    expect(popover(editor)).not.toBeNull();
    expect(keydown(editor, 'Escape')).toBe(true);
    expect(popover(editor)).toBeNull();
    expect(editor.getText()).toBe('[[deploy');
    editor.destroy();
  });

  it('resumes offering matches once typing continues after Escape', () => {
    const editor = editorWith('');
    type(editor, '[[deploy');
    keydown(editor, 'Escape');
    expect(popover(editor)).toBeNull();
    type(editor, 'x');
    expect(popover(editor)).not.toBeNull();
    editor.destroy();
  });
});

describe('aria wiring on the editor host', () => {
  // Focus never leaves `.ProseMirror` while this menu is open — there is no
  // dedicated filter input the way `CodeLanguageControls` has one — so the
  // standard editable-combobox ARIA (`role`, `aria-expanded`,
  // `aria-controls`, `aria-activedescendant`) rides `view.dom` itself. Every
  // assertion below is BY VALUE against a real option id, not merely
  // "the attribute exists": `toHaveProperty('pos')`-shaped assertions are
  // exactly the near-vacuous pattern this project's CLAUDE.md calls out as
  // having passed against a sabotaged implementation before.
  const DESIGN_TITLES = ['Design Review', 'Design Notes', 'Design Draft', 'Weekly Standup'];

  it('sets role=combobox and aria-expanded=true only while the menu is open', () => {
    const editor = editorWith('', LABELS, DESIGN_TITLES);
    // Tiptap's own `Editor` stamps `role="textbox"` on `view.dom` at
    // construction, with no `editorProps.attributes` involved — this is the
    // REAL baseline a bare test-harness editor carries, measured rather than
    // assumed; `RichEditor` carries the same value through its own explicit
    // `editorProps.attributes`, so the baseline this plugin must restore to
    // is identical either way.
    const baseline = editor.view.dom.getAttribute('role');
    expect(baseline).toBe('textbox');

    type(editor, '[[design');
    expect(editor.view.dom.getAttribute('role')).toBe('combobox');
    expect(editor.view.dom.getAttribute('aria-expanded')).toBe('true');

    keydown(editor, 'Escape');
    expect(editor.view.dom.getAttribute('role')).toBe(baseline);
    expect(editor.view.dom.getAttribute('aria-expanded')).toBeNull();
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toBeNull();

    editor.destroy();
  });

  it('aria-controls names the actual rendered listbox id', () => {
    const editor = editorWith('', LABELS, DESIGN_TITLES);
    type(editor, '[[design');

    const list = editor.view.dom.querySelector('[role="listbox"]') as HTMLElement;
    expect(list.id).not.toBe('');
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(list.id);

    editor.destroy();
  });

  it('aria-activedescendant names the active option BY VALUE, and tracks ArrowDown', () => {
    const editor = editorWith('', LABELS, DESIGN_TITLES);
    type(editor, '[[design');

    // Three matches: 'Design Review', 'Design Notes', 'Design Draft'.
    const rows = () => options(editor);
    expect(rows()).toHaveLength(3);

    // Move off the first row before asserting, per the coordinator's brief:
    // pin the SECOND row active, then prove ArrowDown moves it to the third
    // — a check that would pass with a stale or entirely absent attribute
    // must fail here.
    expect(keydown(editor, 'ArrowDown')).toBe(true);
    const second = rows()[1]!;
    expect(second.textContent).toBe('Design Notes');
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toBe(second.id);

    expect(keydown(editor, 'ArrowDown')).toBe(true);
    const third = rows()[2]!;
    expect(third.textContent).toBe('Design Draft');
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toBe(third.id);
    expect(editor.view.dom.getAttribute('aria-activedescendant')).not.toBe(second.id);

    editor.destroy();
  });

  it('restores whatever role the host carried before, on close and on destroy', () => {
    // `originalRole` is captured once per plugin-view instance, so whatever
    // baseline this particular editor happened to carry (`"textbox"` here,
    // via Tiptap's own default — see the test above) is what a close or a
    // destroy must return to, not a hardcoded assumption.
    const editor = editorWith('', LABELS, DESIGN_TITLES);
    const dom = editor.view.dom;
    const baseline = dom.getAttribute('role');
    type(editor, '[[design');
    expect(dom.getAttribute('role')).toBe('combobox');

    keydown(editor, 'Escape');
    expect(dom.getAttribute('role')).toBe(baseline);

    type(editor, 'x');
    expect(dom.getAttribute('role')).toBe('combobox');

    editor.destroy();
    expect(dom.getAttribute('role')).toBe(baseline);
    expect(dom.getAttribute('aria-expanded')).toBeNull();
    expect(dom.getAttribute('aria-controls')).toBeNull();
    expect(dom.getAttribute('aria-activedescendant')).toBeNull();
  });
});

describe('the trailing-node hazard', () => {
  // `TrailingNode.appendTransaction` (from `@tiptap/extensions`, bundled by
  // StarterKit) is NOT gated on `docChanged`, and its own tracked
  // "does the doc still end in a disallowed node" flag is set once, from the
  // INITIAL document, at plugin-state `init` — before any transaction is
  // ever dispatched. Consequence, measured directly rather than assumed: on
  // a note ending in a list, the very FIRST dispatched transaction against
  // that editor appends a trailing paragraph UNLESS it carries
  // `skipTrailingNodeMeta` — and this is true of ANY transaction, including
  // a bare `editor.commands.setTextSelection()` that touches nothing this
  // extension owns. Once that first append happens, the doc's last node is
  // a plain paragraph, the flag flips permanently false, and every
  // subsequent transaction — tagged or not — is a no-op for this hazard.
  //
  // That makes the obvious test shape wrong: "type `[[de`, then fire
  // Escape/ArrowDown, then diff the doc" does NOT exercise Escape's or
  // ArrowDown's own tag, because typing `[[de` is itself an untagged real
  // edit that already consumes the vulnerability before Escape ever runs —
  // verified by deliberately sabotaging Escape's tag and watching that
  // version of the test keep passing anyway. `quietlySelect` below is what
  // keeps the vulnerability alive going into the dispatch under test: it
  // moves the caret with a RAW, explicitly-tagged transaction that bypasses
  // `editor.commands.setTextSelection` (which is not tagged, and would burn
  // the vulnerability itself).
  const LIST_ENDING_MARKDOWN = 'note [[de\n\n- one\n- two';

  function docJSON(editor: Editor): unknown {
    return editor.getJSON();
  }

  function quietlySelect(editor: Editor, pos: number): void {
    const selection = TextSelection.near(editor.state.doc.resolve(pos));
    editor.view.dispatch(
      editor.state.tr.setSelection(selection).setMeta(skipTrailingNodeMeta, true),
    );
  }

  it('setLinkAutocompleteTitles does not mutate a note ending in a list', () => {
    // No `editorWith` here, deliberately: that helper's own convenience call
    // to `setLinkAutocompleteTitles` would itself be the first dispatch, so
    // testing a SECOND call after it would miss a missing tag on the first.
    const editor = new Editor({
      extensions: buildEditorExtensions({ linkAutocompleteLabels: LABELS }),
      content: parseMarkdown(LIST_ENDING_MARKDOWN),
    });
    const before = docJSON(editor);
    // The first transaction ever dispatched against this editor.
    editor.commands.setLinkAutocompleteTitles(['Another Title']);
    expect(docJSON(editor)).toEqual(before);
    editor.destroy();
  });

  it('the Escape dismissal does not mutate a note ending in a list', () => {
    const editor = editorWith(LIST_ENDING_MARKDOWN);
    // Position 10 is right after "note [[de" (9 characters, content starts
    // at position 1) — an open, unclosed match with query "de".
    quietlySelect(editor, 10);
    expect(linkAutocompleteMatchAt(editor.state)?.query).toBe('de');

    const before = docJSON(editor);
    expect(keydown(editor, 'Escape')).toBe(true);
    expect(docJSON(editor)).toEqual(before);
    editor.destroy();
  });

  it('an ArrowDown move does not mutate a note ending in a list', () => {
    const editor = editorWith(LIST_ENDING_MARKDOWN);
    quietlySelect(editor, 10);
    expect(linkAutocompleteMatchAt(editor.state)?.query).toBe('de');

    const before = docJSON(editor);
    expect(keydown(editor, 'ArrowDown')).toBe(true);
    expect(docJSON(editor)).toEqual(before);
    editor.destroy();
  });
});
