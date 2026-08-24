import { Editor, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { codeBlockPosAt, codeLanguageControlsKey } from './CodeLanguageControls';
import { parseMarkdown, serializeMarkdown } from './markdown';

const LABELS = {
  trigger: 'Code language',
  none: 'Plain text',
  filter: 'Filter languages',
  empty: 'No matching language',
};

function editorWith(markdown: string, codeLabels: typeof LABELS | null = LABELS): Editor {
  return new Editor({
    extensions: buildEditorExtensions({ codeLabels }),
    content: parseMarkdown(markdown),
  });
}

/** Puts the caret inside the (first, and only, in these fixtures) code block. */
function selectInsideCode(editor: Editor): void {
  let pos: number | null = null;
  editor.state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === 'codeBlock') pos = at + 1;
    return pos === null;
  });
  expect(pos).not.toBeNull();
  editor.commands.setTextSelection(pos!);
}

function trigger(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('[data-code-language="trigger"]');
}

function popover(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.bear-code-language-popover');
}

function filterInput(editor: Editor): HTMLInputElement | null {
  return editor.view.dom.querySelector('[data-code-language="filter"]');
}

function optionFor(editor: Editor, id: string | null): Element | null {
  return editor.view.dom.querySelector(`[data-code-language-option="${id ?? ''}"]`);
}

function list(editor: Editor): HTMLUListElement | null {
  return editor.view.dom.querySelector('[data-code-language="list"]');
}

function activeOption(editor: Editor): Element | null {
  return editor.view.dom.querySelector('[role="option"].is-active');
}

/**
 * Invokes the plugin's own `handleDOMEvents` handler against the REAL
 * mounted view, the same approach `tableControls.test.ts` uses and for the
 * same reason: these handlers resolve through `closest()`/`event.target`, so
 * they need no layout engine, only real elements.
 */
function fireOn(
  editor: Editor,
  type: 'mousedown' | 'input' | 'keydown',
  target: Element,
  init: MouseEventInit & KeyboardEventInit = {},
): { handled: boolean; defaultPrevented: boolean } {
  const EventCtor = type === 'keydown' ? KeyboardEvent : type === 'input' ? Event : MouseEvent;
  const event = new EventCtor(type, { cancelable: true, bubbles: true, ...init });
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers[type] === undefined ? false : handlers[type]!(editor.view, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

function open(editor: Editor): void {
  const result = fireOn(editor, 'mousedown', trigger(editor)!, { button: 0 });
  expect(result.handled).toBe(true);
}

describe('codeBlockPosAt', () => {
  it('finds the code block the selection is inside', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    editor.commands.setTextSelection(3);
    expect(codeBlockPosAt(editor.state)).not.toBeNull();
    editor.destroy();
  });

  it('is null when the selection is in a paragraph', () => {
    const editor = editorWith('just text');
    editor.commands.setTextSelection(2);
    expect(codeBlockPosAt(editor.state)).toBeNull();
    editor.destroy();
  });
});

describe('the code language controls schema contract', () => {
  // Same blind spot `TableControls`/`HeadingFold` document: this is an
  // Extension that decorates and never mutates, so every Markdown
  // round-trip test in the suite passes whether or not this plugin runs.
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);
    expect(Object.keys(schema.nodes)).not.toContain('codeLanguageControls');
    expect(Object.keys(schema.marks)).not.toContain('codeLanguageControls');
  });
});

describe('the trigger', () => {
  it('is absent while the caret is outside a code block', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```\n\nplain text');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(trigger(editor)).toBeNull();
    editor.destroy();
  });

  it('appears when the caret moves into the block, and goes again when it leaves', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```\n\nplain text');

    selectInsideCode(editor);
    expect(trigger(editor)).not.toBeNull();

    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(trigger(editor)).toBeNull();

    editor.destroy();
  });

  it('shows the display name for a known fence and names what it DOES, not just the language', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    selectInsideCode(editor);

    expect(trigger(editor)?.textContent).toBe('TypeScript');
    expect(trigger(editor)?.getAttribute('aria-label')).toBe('Code language: TypeScript');
    expect(trigger(editor)?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(editor)?.getAttribute('aria-expanded')).toBe('false');

    editor.destroy();
  });

  it('echoes an unknown fence verbatim rather than discarding it', () => {
    const editor = editorWith('```rust\nfn main() {}\n```');
    selectInsideCode(editor);

    expect(trigger(editor)?.textContent).toBe('rust');

    editor.destroy();
  });

  it('shows the "no language" label for a bare fence', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);

    expect(trigger(editor)?.textContent).toBe('Plain text');

    editor.destroy();
  });

  // The schema-only `editorExtensions` constant supplies no labels. A
  // control with no user-facing text would be worse than none at all, so
  // with no labels there is no plugin — same contract as `TableControls`.
  it('renders nothing at all when the caller supplied no labels', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: parseMarkdown('```ts\nx\n```'),
    });
    selectInsideCode(editor);

    expect(trigger(editor)).toBeNull();
    const plugins = editor.state.plugins.filter((p) => p.spec.key === codeLanguageControlsKey);
    expect(plugins).toHaveLength(0);

    editor.destroy();
  });

  it('renders nothing when the caller explicitly passes null', () => {
    const editor = editorWith('```ts\nx\n```', null);
    selectInsideCode(editor);

    expect(trigger(editor)).toBeNull();
    const plugins = editor.state.plugins.filter((p) => p.spec.key === codeLanguageControlsKey);
    expect(plugins).toHaveLength(0);

    editor.destroy();
  });
});

describe('opening and closing the popover', () => {
  it('Enter on the trigger opens the popover, focuses the list, and seeds the active option', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    selectInsideCode(editor);

    const result = fireOn(editor, 'keydown', trigger(editor)!, { key: 'Enter' });

    expect(result.handled).toBe(true);
    expect(popover(editor)?.hidden).toBe(false);
    expect(trigger(editor)?.getAttribute('aria-expanded')).toBe('true');
    expect(list(editor)).not.toBeNull();

    editor.destroy();
  });

  it('Space on the trigger toggles it too, and a second press closes it', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);

    fireOn(editor, 'keydown', trigger(editor)!, { key: ' ' });
    expect(popover(editor)?.hidden).toBe(false);

    fireOn(editor, 'keydown', trigger(editor)!, { key: ' ' });
    expect(popover(editor)?.hidden).toBe(true);

    editor.destroy();
  });

  it('is hidden until the trigger is activated', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);

    expect(popover(editor)?.hidden).toBe(true);

    editor.destroy();
  });

  it('opens on a left click, marks aria-expanded, and does not move the caret', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);

    const result = fireOn(editor, 'mousedown', trigger(editor)!, { button: 0 });

    expect(result.handled).toBe(true);
    expect(result.defaultPrevented).toBe(true);
    expect(popover(editor)?.hidden).toBe(false);
    expect(trigger(editor)?.getAttribute('aria-expanded')).toBe('true');

    editor.destroy();
  });

  it('ignores a right-click on the trigger', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);

    const result = fireOn(editor, 'mousedown', trigger(editor)!, { button: 2 });

    expect(result.handled).toBe(false);
    expect(popover(editor)?.hidden).toBe(true);

    editor.destroy();
  });

  it('a second click on the trigger closes it again', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);

    open(editor);
    fireOn(editor, 'mousedown', trigger(editor)!, { button: 0 });

    expect(popover(editor)?.hidden).toBe(true);
    expect(trigger(editor)?.getAttribute('aria-expanded')).toBe('false');

    editor.destroy();
  });

  it('Escape closes the list and returns focus to the trigger', () => {
    const editor = editorWith('```ts\nx\n```');
    const dom = editor.view.dom;
    document.body.appendChild(dom);
    selectInsideCode(editor);
    open(editor);

    const result = fireOn(editor, 'keydown', filterInput(editor)!, { key: 'Escape' });

    expect(result.handled).toBe(true);
    expect(popover(editor)?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger(editor));

    dom.remove();
    editor.destroy();
  });

  it('lets a click on the prose fall through to the editor', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);

    const result = fireOn(editor, 'mousedown', editor.view.dom, { button: 0 });

    expect(result.handled).toBe(false);

    editor.destroy();
  });
});

describe('filtering the list', () => {
  it('lists every language plus "plain text" when unfiltered', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);
    open(editor);

    const options = [...editor.view.dom.querySelectorAll('[data-code-language-option]')];
    expect(options).toHaveLength(13); // 12 languages + "plain text"

    editor.destroy();
  });

  it('narrows the list as the caller types', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);
    open(editor);

    const input = filterInput(editor)!;
    input.value = 'yaml';
    fireOn(editor, 'input', input);

    const options = [...editor.view.dom.querySelectorAll('[data-code-language-option]')];
    expect(options.map((el) => el.textContent)).toEqual(['YAML']);

    editor.destroy();
  });

  it('shows the empty-state label when nothing matches', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);
    open(editor);

    const input = filterInput(editor)!;
    input.value = 'nonexistent-language';
    fireOn(editor, 'input', input);

    expect(editor.view.dom.querySelector('.bear-code-language-empty')?.textContent).toBe(
      'No matching language',
    );
    expect(editor.view.dom.querySelectorAll('[data-code-language-option]')).toHaveLength(0);

    editor.destroy();
  });

  it('marks the currently active language as selected', () => {
    const editor = editorWith('```ts\nx\n```');
    selectInsideCode(editor);
    open(editor);

    expect(optionFor(editor, 'typescript')?.getAttribute('aria-selected')).toBe('true');
    expect(optionFor(editor, 'python')?.getAttribute('aria-selected')).toBe('false');

    editor.destroy();
  });
});

describe('choosing a language', () => {
  it('sets the language on the node', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    const result = fireOn(editor, 'mousedown', optionFor(editor, 'python')!, { button: 0 });

    expect(result.handled).toBe(true);
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('python');
    expect(popover(editor)?.hidden).toBe(true);

    editor.destroy();
  });

  // `ts` must stay `ts`. Normalizing it to `typescript` would silently edit
  // the user's file on the next autosave — exactly what
  // docs/rulings/notes-lifecycle.md exists to prevent.
  it('does NOT rewrite a fence that already names the same language by alias', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    selectInsideCode(editor);
    open(editor);

    const before = serializeMarkdown(editor.getJSON());
    fireOn(editor, 'mousedown', optionFor(editor, 'typescript')!, { button: 0 });

    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('ts');
    expect(serializeMarkdown(editor.getJSON())).toBe(before);

    editor.destroy();
  });

  // An unknown language is never rewritten or replaced with a nearest
  // match — but choosing "Plain text" over it is a genuine, deliberate edit,
  // not a no-op, because the fence is not already blank.
  it('an unknown language can be explicitly cleared to plain text', () => {
    const editor = editorWith('```rust\nfn main() {}\n```');
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'mousedown', optionFor(editor, null)!, { button: 0 });

    expect(editor.getJSON().content?.[0]?.attrs?.language).toBeNull();

    editor.destroy();
  });

  it('ignores a right-click on an option', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    const result = fireOn(editor, 'mousedown', optionFor(editor, 'python')!, { button: 2 });

    expect(result.handled).toBe(false);
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBeNull();

    editor.destroy();
  });

  // A `Decoration.widget` is matched and reused by (pos, side, key) across
  // transactions — the same mechanic `TableControls`' own comment documents
  // for why its bar survives edits inside the same table without rebuilding.
  // That means a fresh `decorations()` call after `choose()` returns the
  // SAME cached DOM node rather than calling `controlElement` again, so the
  // trigger's own label has to be refreshed directly or it goes stale.
  it("updates the trigger's own label immediately, without waiting for a re-decoration", () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'mousedown', optionFor(editor, 'python')!, { button: 0 });

    expect(trigger(editor)?.textContent).toBe('Python');
    expect(trigger(editor)?.getAttribute('aria-label')).toBe('Code language: Python');

    editor.destroy();
  });

  it('returns focus to the editor after choosing', () => {
    const editor = editorWith('```\nplain\n```');
    const dom = editor.view.dom;
    document.body.appendChild(dom);
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'mousedown', optionFor(editor, 'python')!, { button: 0 });

    expect(document.activeElement).toBe(dom);

    dom.remove();
    editor.destroy();
  });
});

describe('keyboard navigation', () => {
  it('lands the active option on the CURRENT language when the popover opens', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    selectInsideCode(editor);
    open(editor);

    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('typescript');
    expect(list(editor)?.getAttribute('aria-activedescendant')).toBe(activeOption(editor)?.id);

    editor.destroy();
  });

  it('defaults the active option to the first row when the fence is unknown', () => {
    const editor = editorWith('```rust\nfn main() {}\n```');
    selectInsideCode(editor);
    open(editor);

    // "Plain text" is the first entry `choices()` yields.
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('');

    editor.destroy();
  });

  it('ArrowDown moves to the next option and wraps past the last', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    // Starts on "Plain text" (index 0, 13 options total).
    fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' });
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('bash');

    for (let i = 0; i < 12; i += 1) {
      fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' });
    }
    // 12 more downs from "bash" (index 1) wraps back around to index 0.
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('');

    editor.destroy();
  });

  it('ArrowUp moves to the previous option and wraps past the first', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    const result = fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowUp' });
    expect(result.handled).toBe(true);
    // Wrapped from "Plain text" (index 0) to the last entry, YAML.
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('yaml');

    editor.destroy();
  });

  it('Home and End jump to the first and last option', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'keydown', list(editor)!, { key: 'End' });
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('yaml');

    fireOn(editor, 'keydown', list(editor)!, { key: 'Home' });
    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('');

    editor.destroy();
  });

  it('Enter selects the active option', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' }); // -> bash
    const result = fireOn(editor, 'keydown', list(editor)!, { key: 'Enter' });

    expect(result.handled).toBe(true);
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('bash');
    expect(popover(editor)?.hidden).toBe(true);

    editor.destroy();
  });

  it('Space selects the active option when the list has focus', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' }); // -> bash
    fireOn(editor, 'keydown', list(editor)!, { key: ' ' });

    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('bash');

    editor.destroy();
  });

  it('Space is left alone (typed, not a selection) while the filter input has focus', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    const result = fireOn(editor, 'keydown', filterInput(editor)!, { key: ' ' });

    expect(result.handled).toBe(false);
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBeNull();

    editor.destroy();
  });

  it('typing into the filter resets the active option to the first match, not a stale index', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    // Move away from index 0 first, so a reset is actually observable.
    fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' });
    fireOn(editor, 'keydown', list(editor)!, { key: 'ArrowDown' });

    const input = filterInput(editor)!;
    input.value = 'ya';
    fireOn(editor, 'input', input);

    expect(activeOption(editor)?.getAttribute('data-code-language-option')).toBe('yaml');
    expect(list(editor)?.getAttribute('aria-activedescendant')).toBe(activeOption(editor)?.id);

    editor.destroy();
  });

  it('does not mark any option as keyboard-active when nothing matches the filter', () => {
    const editor = editorWith('```\nplain\n```');
    selectInsideCode(editor);
    open(editor);

    const input = filterInput(editor)!;
    input.value = 'nonexistent-language';
    fireOn(editor, 'input', input);

    expect(activeOption(editor)).toBeNull();
    expect(list(editor)?.hasAttribute('aria-activedescendant')).toBe(false);

    editor.destroy();
  });
});

describe('aria-selected for an unknown fence', () => {
  // `rust` is neither a known language nor blank, so it is not "plain text"
  // either — no option should read as selected over it.
  it('marks no option as selected when the fence names an unknown language', () => {
    const editor = editorWith('```rust\nfn main() {}\n```');
    selectInsideCode(editor);
    open(editor);

    const selected = [...editor.view.dom.querySelectorAll('[role="option"]')].filter(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(0);

    editor.destroy();
  });
});

describe('closing on an outside click', () => {
  it('closes the popover when a mousedown lands outside the widget entirely', () => {
    const editor = editorWith('```\nplain\n```');
    const dom = editor.view.dom;
    document.body.appendChild(dom);
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    selectInsideCode(editor);
    open(editor);
    expect(popover(editor)?.hidden).toBe(false);

    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(popover(editor)?.hidden).toBe(true);
    // Focus was not forced back to the trigger — the click target is left
    // alone, since the user was doing something else on purpose.
    expect(document.activeElement).not.toBe(trigger(editor));

    outside.remove();
    dom.remove();
    editor.destroy();
  });

  it('a click inside the widget itself does not close it', () => {
    const editor = editorWith('```\nplain\n```');
    const dom = editor.view.dom;
    document.body.appendChild(dom);

    selectInsideCode(editor);
    open(editor);

    popover(editor)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(popover(editor)?.hidden).toBe(false);

    dom.remove();
    editor.destroy();
  });
});
