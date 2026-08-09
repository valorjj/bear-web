import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle } from './RichEditor';

// A block-level toggle (list, blockquote, code block) calls ProseMirror's
// `tr.scrollIntoView()` internally, and clicking a toolbar button blurs the
// editor, so the pending `.focus()` this project's toolbars chain schedules
// a browser scroll for the *next* animation frame. Once this suite's fix
// pins a real `AllSelection` to a concrete `TextSelection` (see
// `toolbarSelection.ts`), that scroll needs to resolve on-screen coordinates
// for content inside a real text node — `Range.getClientRects`, which jsdom
// does not implement. This is the same documented gap as "jsdom lacks
// elementFromPoint/getClientRects" for clicks *inside* the editor; here it
// is reached indirectly, via a toolbar button click's side effect, not a
// direct click on editor content. Stubbing the scroll call sidesteps a
// jsdom limitation that has nothing to do with document correctness —
// `scrollToSelection` only moves the viewport, never the document — without
// touching the project's shared `vitest.setup.ts`, since no other test file
// exercises this path.
// `scrollToSelection` is a real, public-at-runtime method (the crash's own
// stack trace names it), but prosemirror-view's published types mark it
// internal, so `EditorView.prototype` must be cast to spy on it.
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

function renderEditor(initialMarkdown: string): {
  handleRef: React.RefObject<RichEditorHandle | null>;
} {
  const handleRef = createRef<RichEditorHandle>();
  renderWithI18n(
    <RichEditor
      initialMarkdown={initialMarkdown}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      ariaLabel="Note text"
      handleRef={handleRef}
      createdAt={new Date(2026, 0, 15, 9, 0).getTime()}
      updatedAt={new Date(2026, 0, 15, 9, 0).getTime()}
    />,
  );
  return { handleRef };
}

function bottomToolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Formatting toolbar' });
}

function topToolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Top controls' });
}

describe('the bottom toolbar', () => {
  it('renders every action with an accessible name', async () => {
    renderEditor('Some text.');
    await screen.findByLabelText('Note text');

    for (const name of ['Heading', 'Checklist', 'Bullet list', 'Bold', 'Italic', 'Highlight']) {
      expect(within(bottomToolbar()).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('applies bold to the document, not just to the button state', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Bold' }));

    expect(handleRef.current?.getMarkdown()).toBe('**word**');
  });

  it('applies highlight to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Highlight' }));

    expect(handleRef.current?.getMarkdown()).toBe('==word==');
  });

  it('applies a checklist to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Checklist' }));

    // The exact string, trailing content included: `TrailingNode` (from
    // StarterKit, part of `editorExtensions`) appends an empty paragraph
    // after a block like a list so the user has somewhere to click below
    // it. That is real, permanent structure, not test noise — pinned here
    // rather than `.trim()`-ed away, per the finding that hiding it is what
    // let a real corruption bug (see "repeated and mixed block toggles"
    // below) go undetected.
    expect(handleRef.current?.getMarkdown()).toBe('- [ ] word\n\n');
  });

  it('applies a bullet list to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Bullet list' }));

    expect(handleRef.current?.getMarkdown()).toBe('- word\n\n');
  });

  it('applies a numbered list to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Numbered list' }));

    expect(handleRef.current?.getMarkdown()).toBe('1. word\n\n');
  });

  it('applies strikethrough to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Strikethrough' }));

    expect(handleRef.current?.getMarkdown()).toBe('~~word~~');
  });

  it('applies a code block to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Code block' }));

    expect(handleRef.current?.getMarkdown()).toBe('```\nword\n```\n\n');
  });

  it('applies a quote to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Quote' }));

    expect(handleRef.current?.getMarkdown()).toBe('> word\n\n');
  });

  describe('the link action', () => {
    // Scoped to just this one spy, not `vi.restoreAllMocks()` — that would
    // also tear down the file-level `scrollToSelectionSpy` above and crash
    // every test that runs after this block in jsdom.
    let promptSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      promptSpy.mockRestore();
    });

    it('applies a link to the document', async () => {
      promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
      const { handleRef } = renderEditor('word');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.selectAll();
      await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Link' }));

      expect(handleRef.current?.getMarkdown()).toBe('[word](https://example.com)');
    });
  });

  it('does not offer underline, which has no markdown representation', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    expect(screen.queryByRole('button', { name: /underline/i })).not.toBeInTheDocument();
  });
});

/**
 * A real, silent corruption bug: after selecting the whole document,
 * clicking the same block-level button (or a different one, without
 * reselecting in between) repeated toggling instead of an ever-growing
 * document. Root cause is in `toolbarSelection.ts`: ProseMirror's
 * `AllSelection` never shrinks back to a fixed range as the document
 * changes, so a stale selection kept re-including content a *previous*
 * toggle's `TrailingNode` had appended. These tests click more than once —
 * the exact thing every other test in this file does not do — and assert
 * on the exact string, trailing content included, per the finding that
 * `.trim()` is what let this go undetected the first time.
 */
describe('repeated and mixed block toggles do not grow the document', () => {
  it('toggling checklist twice returns to the original text, not a duplicate', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    const checklist = within(bottomToolbar()).getByRole('button', { name: 'Checklist' });

    await userEvent.click(checklist);
    expect(handleRef.current?.getMarkdown()).toBe('- [ ] word\n\n');

    await userEvent.click(checklist);
    // Not the pristine 'word' the note started as: toggling the checklist on
    // once made TrailingNode append a trailing empty paragraph, and toggling
    // back off lifts the list but does not retroactively remove a paragraph
    // that is no longer needed — a separate, stable, pre-existing quirk of
    // TrailingNode, not the corruption this test targets. What matters here
    // is what toggling off does NOT do: it does not leave list markup behind,
    // and it does not grow past this one harmless trailing blank line.
    expect(handleRef.current?.getMarkdown()).toBe('word\n\n');
  });

  it('toggling checklist four times is identical to toggling it twice', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    const checklist = within(bottomToolbar()).getByRole('button', { name: 'Checklist' });

    await userEvent.click(checklist);
    await userEvent.click(checklist);
    const afterTwo = handleRef.current?.getMarkdown();

    await userEvent.click(checklist);
    await userEvent.click(checklist);
    const afterFour = handleRef.current?.getMarkdown();

    expect(afterFour).toBe(afterTwo);
    expect(afterFour).toBe('word\n\n');
  });

  it('toggling checklist then quote, without reselecting, does not nest them', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Checklist' }));
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Quote' }));

    // A blockquote cannot wrap a task list in this schema, so the second
    // click is rejected outright — the document is exactly what the first
    // click alone produced. That is a schema restriction, not a bug: the
    // point of this test is that the rejection stays a no-op instead of
    // partially applying and leaving duplicated or nested structure behind.
    expect(handleRef.current?.getMarkdown()).toBe('- [ ] word\n\n');
  });

  it('toggling quote then code block, without reselecting, nests once and does not duplicate', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Quote' }));
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Code block' }));

    // One clean nesting — a code block inside the quote — never the
    // duplicated, multiplying fences the unfixed selection produced.
    expect(handleRef.current?.getMarkdown()).toBe('> ```\n> word\n> ```\n\n');
  });
});

describe('the top toolbar', () => {
  it('has its own Bold button, distinguished from the bottom toolbar by the toolbar landmark', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    expect(within(topToolbar()).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(within(bottomToolbar()).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  });

  it("acts on the same document as the bottom toolbar's Bold button", async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(topToolbar()).getByRole('button', { name: 'Bold' }));

    expect(handleRef.current?.getMarkdown()).toBe('**word**');
  });
});

describe('the info panel', () => {
  it('counts words and characters in the document', async () => {
    renderEditor('one two three');
    await screen.findByLabelText('Note text');

    await userEvent.click(screen.getByRole('button', { name: 'Note information' }));

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });
});
