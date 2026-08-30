import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

/**
 * The code block's copy button.
 *
 * Every test here drives the REAL plugin through a mounted editor rather than
 * calling helpers directly, because the two things most likely to be wrong are
 * both structural: that a widget exists for every code block rather than only
 * the focused one, and that the button copies ITS OWN block's text rather than
 * the first one's.
 */

const createdEditors: Editor[] = [];

function editorWith(markdown: string): Editor {
  const editor = new Editor({
    // Labels are passed the way `RichEditor` passes them — already
    // translated, because an extension has no access to `useT`. Building with
    // none would leave the button unnamed and make the name assertions below
    // test the default rather than the shipped control.
    extensions: buildEditorExtensions({
      codeCopyLabel: 'Copy code',
      codeCopiedLabel: 'Copied',
      codeCopyFailedLabel: 'Could not copy',
    }),
    content: parseMarkdown(markdown),
  });
  createdEditors.push(editor);
  return editor;
}

/**
 * `navigator.clipboard` does not exist in jsdom at all — the property is
 * absent, not a stub returning undefined — so it is installed per test and
 * removed afterwards. This mirrors `NoteList.test.tsx`, which had to do the
 * same for the note-row copy action.
 */
function stubClipboard(impl: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // An undestroyed `Editor` leaves ProseMirror's `DOMObserver` polling on a
  // timer that outlives this file's jsdom environment, which makes
  // `vitest run` exit 1 with every assertion passing. See CLAUDE.md.
  for (const editor of createdEditors.splice(0)) editor.destroy();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const TWO_BLOCKS = 'Title\n\n```js\nfirst()\n```\n\ntext\n\n```py\nsecond()\n```';

describe('the copy button widget', () => {
  it('renders one button per code block, not one for the focused block', () => {
    const editor = editorWith(TWO_BLOCKS);

    // Two, not one: the language picker is anchored to the caret's block, and
    // copying a block you are NOT editing is the whole point of this control.
    expect(editor.view.dom.querySelectorAll('[data-code-copy]')).toHaveLength(2);
  });

  it('renders none when the note has no code block', () => {
    const editor = editorWith('Title\n\nJust a paragraph with `inline code` in it.');

    expect(editor.view.dom.querySelectorAll('[data-code-copy]')).toHaveLength(0);
  });

  it('sits OUTSIDE the scrolling `pre`, so horizontal code scroll cannot move it', () => {
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]');

    // `.ProseMirror pre` is `overflow-x: auto`. A control inside that box
    // scrolls away with long lines and is clipped at its edge; there is no
    // CSS that rescues a child of a scroll container from this.
    expect(button?.closest('pre')).toBeNull();
  });
});

describe('copying', () => {
  it('copies its own block’s text, not the first block’s', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const editor = editorWith(TWO_BLOCKS);
    const buttons = editor.view.dom.querySelectorAll('[data-code-copy]');

    (buttons[1] as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);

    // A specific value, and the SECOND one — a handler that resolved the
    // position from the document's first code block, or from the selection,
    // would copy `first()` and pass a laxer assertion.
    expect(writeText).toHaveBeenCalledWith('second()');
  });

  it('copies the block’s text without the fence or the language', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const editor = editorWith('Title\n\n```js\nconst a = 1;\nconst b = 2;\n```');

    (editor.view.dom.querySelector('[data-code-copy]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
  });

  it('reports success on the button, then returns to rest', async () => {
    stubClipboard(() => Promise.resolve());
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]') as HTMLElement;

    expect(button.dataset.state).toBe('idle');

    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.dataset.state).toBe('copied');

    await vi.advanceTimersByTimeAsync(2000);
    expect(button.dataset.state).toBe('idle');
  });

  it('reports a FAILED copy rather than swallowing it', async () => {
    // The reason this test exists: `navigator.clipboard` is absent in jsdom,
    // absent over plain HTTP on a non-localhost origin, and `writeText`
    // REJECTS when the document is not focused. Every one of those is silent
    // without an explicit failure state, so a user would press the button,
    // see nothing change, and paste something stale.
    stubClipboard(() => Promise.reject(new Error('not focused')));
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]') as HTMLElement;

    button.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(button.dataset.state).toBe('failed');
  });

  it('reports a failure when the clipboard API is absent entirely', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]') as HTMLElement;

    button.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(button.dataset.state).toBe('failed');
  });
});

describe('living beside the language picker', () => {
  /**
   * A regression, found before shipping and worth keeping.
   *
   * `CodeLanguageControls` puts its OWN `side: -1` widget at the same document
   * position whenever the caret is inside the block, so its chip lands between
   * this button's anchor and the `<pre>`. Reading only `nextElementSibling`
   * made the copy silently fail for exactly the block being edited.
   *
   * Note the first assertion: without `codeLabels` that extension registers no
   * plugin at all, and an earlier version of this test passed while the picker
   * never rendered — proving nothing. The count is asserted so the test cannot
   * quietly stop exercising the collision.
   */
  it('still copies when the picker sits between the button and the block', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const editor = new Editor({
      extensions: buildEditorExtensions({
        codeCopyLabel: 'Copy code',
        codeCopiedLabel: 'Copied',
        codeCopyFailedLabel: 'Could not copy',
        codeLabels: { trigger: 'L', none: 'N', filter: 'F', empty: 'E' },
      }),
      content: parseMarkdown('Title\n\n```js\nfirst()\n```'),
    });
    createdEditors.push(editor);

    let codePos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') codePos = pos;
      return true;
    });
    editor.commands.setTextSelection(codePos + 1);

    expect(
      editor.view.dom.querySelectorAll('.bear-code-language'),
      'the picker did not render, so this test proves nothing',
    ).toHaveLength(1);

    (editor.view.dom.querySelector('[data-code-copy]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith('first()');
  });
});

describe('the button’s accessible name', () => {
  it('carries a real label, and announces the outcome', async () => {
    stubClipboard(() => Promise.resolve());
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]') as HTMLElement;

    expect(button.getAttribute('aria-label')).toBe('Copy code');

    button.click();
    await vi.advanceTimersByTimeAsync(0);

    // The name changes with the state, so a screen reader hears the result
    // rather than the same word twice. `aria-live` on a widget ProseMirror
    // rebuilds is unreliable; the name is what survives a re-render.
    expect(button.getAttribute('aria-label')).toBe('Copied');
  });

  it('is a real <button>, so Enter and Space activate it', () => {
    const editor = editorWith('Title\n\n```js\nfirst()\n```');
    const button = editor.view.dom.querySelector('[data-code-copy]');

    // Unlike the fold gutter's controls, this one is NOT inside a heading, so
    // Chromium's widget-focus exclusion does not apply — see
    // `docs/rulings/accessibility.md`. It can and should be reachable.
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
  });
});
