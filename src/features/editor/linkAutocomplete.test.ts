import { Editor, getSchema } from '@tiptap/core';
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
