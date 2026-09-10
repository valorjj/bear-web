import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle } from './RichEditor';

// Task 5's palette-placement effect calls `posToDOMRect`, which resolves to
// `EditorView.coordsAtPos` and, for a non-collapsed range, `Range.getClientRects`.
// jsdom has no layout engine and implements neither; see the same stub in
// `NoteEditor.test.tsx` and the toolchain note in CLAUDE.md about jsdom lacking
// `coordsAtPos`/`posAtCoords` support.
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

function renderEditor(
  initialMarkdown: string,
  onImage?: (file: Blob) => Promise<string | null>,
): {
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
      onImage={onImage}
      createdAt={new Date(2026, 0, 15, 9, 0).getTime()}
      updatedAt={new Date(2026, 0, 15, 9, 0).getTime()}
    />,
  );
  return { handleRef };
}

function bottomToolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Formatting toolbar' });
}

function calloutButton(): HTMLElement {
  return within(bottomToolbar()).getByRole('button', { name: 'Quote or callout' });
}

/**
 * A plain blockquote takes two steps now.
 *
 * The toolbar's one-click Quote button was replaced by a single stand-alone
 * callout button whose menu's FIRST row is Quote — the cost the user accepted
 * in exchange for losing the chevron that read as a generic "more tools"
 * affordance. Every test that used to click Quote directly goes through here,
 * so the extra step is stated once rather than inlined at each call site.
 */
async function applyPlainQuote(): Promise<void> {
  await userEvent.click(calloutButton());
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Quote' }));
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
    await applyPlainQuote();

    expect(handleRef.current?.getMarkdown()).toBe('> word\n\n');
  });

  describe('the link action', () => {
    /**
     * The address is asked for in an anchored popover, not `window.prompt`.
     *
     * The two tests this block replaces asserted the prompt itself — one of
     * them that it was CALLED with a translated label — so they pinned the
     * native dialog in place. They are gone rather than adapted: the
     * behaviour they described is the behaviour being removed.
     */
    async function openLinkMenu(): Promise<void> {
      await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Link' }));
    }

    function addressField(): HTMLElement {
      return screen.getByRole('textbox', { name: 'Link address' });
    }

    it('asks for the address in a popover, never a native prompt', async () => {
      const promptSpy = vi.spyOn(window, 'prompt');
      renderEditor('word');
      await screen.findByLabelText('Note text');

      await openLinkMenu();

      expect(addressField()).toBeInTheDocument();
      expect(promptSpy).not.toHaveBeenCalled();
      promptSpy.mockRestore();
    });

    it('applies a link to the document', async () => {
      const { handleRef } = renderEditor('word');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.selectAll();
      await openLinkMenu();
      await userEvent.type(addressField(), 'https://example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Add link' }));

      expect(handleRef.current?.getMarkdown()).toBe('[word](https://example.com)');
    });

    /**
     * The selection is captured when the popover OPENS.
     *
     * Focus moves to the text field, so by submit time the live selection is
     * not what the user aimed at. Same rule `ImagePaste.handle` follows for
     * its async inserts, and the reason `pinAllSelectionStep` is not enough:
     * that only normalises an `AllSelection`, it does not survive a focus
     * change.
     */
    it('links the text that was selected when the popover opened', async () => {
      const { handleRef } = renderEditor('one two');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.setTextSelection({ from: 1, to: 4 });
      await openLinkMenu();
      await userEvent.type(addressField(), 'https://example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Add link' }));

      expect(handleRef.current?.getMarkdown()).toBe('[one](https://example.com) two');
    });

    it('prefills the address when the caret is already inside a link', async () => {
      const { handleRef } = renderEditor('[word](https://example.com)');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.setTextSelection({ from: 2, to: 2 });
      await openLinkMenu();

      expect(addressField()).toHaveValue('https://example.com');
    });

    /**
     * Dismissing must change nothing — the defect this whole change carries
     * with it. `window.prompt` returns `null` on Cancel and the old handler
     * read that as "unset the link", so cancelling out of the dialog silently
     * destroyed an existing link.
     */
    it('leaves an existing link untouched when dismissed', async () => {
      const { handleRef } = renderEditor('[word](https://example.com)');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.setTextSelection({ from: 2, to: 2 });
      await openLinkMenu();
      await userEvent.keyboard('{Escape}');

      expect(handleRef.current?.getMarkdown()).toBe('[word](https://example.com)');
    });

    it('removes an existing link through its own button', async () => {
      const { handleRef } = renderEditor('[word](https://example.com)');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.setTextSelection({ from: 2, to: 2 });
      await openLinkMenu();
      await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));

      expect(handleRef.current?.getMarkdown()).toBe('word');
    });

    /**
     * With nothing selected there is no text to carry the mark, and the
     * `window.prompt` version simply did nothing: `setLink` applied a mark to
     * an empty range and the user got no link and no error. Tolerable from a
     * native dialog, broken from a deliberate one — so the address becomes
     * its own link text, which is what every other editor does here.
     */
    it('inserts the address as its own link text when nothing is selected', async () => {
      const { handleRef } = renderEditor('word');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.setTextSelection({ from: 5, to: 5 });
      await openLinkMenu();
      await userEvent.type(addressField(), 'https://example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Add link' }));

      expect(handleRef.current?.getMarkdown()).toBe(
        'word[https://example.com](https://example.com)',
      );
    });

    it('offers no Remove for a selection that is not yet a link', async () => {
      const { handleRef } = renderEditor('word');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.selectAll();
      await openLinkMenu();

      expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument();
    });
  });

  /**
   * The file picker, which Bear's own help calls "the attach function (which
   * looks like a photo)" and places in the toolbar. Only images are accepted
   * here, so a photo glyph is the honest label as well as the familiar one.
   *
   * The REAL encode cannot run in jsdom — it has neither `createImageBitmap`
   * nor `OffscreenCanvas`, which is why `downscaleImage` takes both as
   * injected dependencies and why `e2e/images.spec.ts` owns the only real
   * WebP in the suite. What is worth asserting here is the WIRING: that the
   * button reaches a file input at all, and that a chosen file arrives at the
   * same `onImage` a paste would reach.
   */
  describe('the image attach action', () => {
    function imageButton(): HTMLElement {
      return within(bottomToolbar()).getByRole('button', { name: 'Insert image' });
    }

    /**
     * By its data hook, not by an accessible name: the input is deliberately
     * `aria-hidden` so the toolbar button is the single control in the
     * accessibility tree for this affordance. Same convention as
     * `data-code-copy`.
     */
    function picker(): HTMLInputElement {
      const input = bottomToolbar().querySelector('[data-image-picker]');
      if (!(input instanceof HTMLInputElement)) throw new Error('no image picker input');
      return input;
    }

    it('hands a chosen file to the same onImage a paste uses', async () => {
      const onImage = vi.fn().mockResolvedValue('files/abc.webp');
      renderEditor('word', onImage);
      await screen.findByLabelText('Note text');

      const input = picker();
      await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }));

      await waitFor(() => expect(onImage).toHaveBeenCalledTimes(1));
      expect((onImage.mock.calls[0]![0] as File).name).toBe('shot.png');
    });

    it('accepts images only, so the picker does not offer every file', async () => {
      renderEditor('word', vi.fn());
      await screen.findByLabelText('Note text');

      expect(picker()).toHaveAttribute('accept', 'image/*');
    });

    it('is absent when the editor cannot store an image', async () => {
      renderEditor('word');
      await screen.findByLabelText('Note text');

      expect(
        within(bottomToolbar()).queryByRole('button', { name: 'Insert image' }),
      ).not.toBeInTheDocument();
    });

    it('opens the picker when the toolbar button is clicked', async () => {
      renderEditor('word', vi.fn());
      await screen.findByLabelText('Note text');
      const click = vi.spyOn(picker(), 'click');

      await userEvent.click(imageButton());

      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  // A missing BUTTON is the weakest possible form of this rule, and on its own
  // it passed while underline was live in the schema, bound to Mod-U and
  // serializing to `++text++`. The rule that actually matters is asserted at
  // the schema, in `extensions.test.ts`; this stays as the UI half of it.
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
    await applyPlainQuote();

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
    await applyPlainQuote();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Code block' }));

    // One clean nesting — a code block inside the quote — never the
    // duplicated, multiplying fences the unfixed selection produced.
    expect(handleRef.current?.getMarkdown()).toBe('> ```\n> word\n> ```\n\n');
  });
});

describe('icons', () => {
  it('renders every formatting control as an icon with no text', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    const toolbar = bottomToolbar();
    const buttons = [...toolbar.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelector('svg'), button.getAttribute('aria-label') ?? '').not.toBeNull();
      expect(button.textContent, button.getAttribute('aria-label') ?? '').toBe('');
    }
  });

  it('keeps every control findable by its name', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    for (const name of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Highlight',
      'Link',
      'Code block',
      'Quote or callout',
    ]) {
      expect(within(bottomToolbar()).getByRole('button', { name })).toBeInTheDocument();
    }
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

describe('the callout type menu', () => {
  async function openCalloutMenu(): Promise<HTMLElement> {
    await userEvent.click(calloutButton());
    return screen.getByRole('menu', { name: 'Callout type' });
  }

  it('opens from a stand-alone button that reports its own state', async () => {
    // It was a chevron pinned to the right of a Quote button until the user
    // reported it read as a generic "more tools" affordance rather than as
    // the route to the callout types. One button, one popup, no chevron.
    renderEditor('word');
    await screen.findByLabelText('Note text');

    const button = calloutButton();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('has replaced the Quote button rather than joining it', () => {
    // The picker's first row IS Quote, so a second control for the same thing
    // would be the redundancy this change removed. Asserting the ABSENCE is
    // what stops it drifting back in beside the new button.
    renderEditor('word');

    expect(within(bottomToolbar()).queryByRole('button', { name: 'Quote' })).toBeNull();
    expect(within(bottomToolbar()).queryByRole('button', { name: 'Callout type' })).toBeNull();
  });

  it('writes the chosen type into the document', async () => {
    // The whole loop: menu click -> command -> document -> Markdown. The
    // component tests assert the menu's own semantics; this is the only thing
    // that proves the wiring between them.
    const { handleRef } = renderEditor('Be careful');
    await screen.findByLabelText('Note text');

    const menu = await openCalloutMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Warning' }));

    await waitFor(() => expect(handleRef.current?.getMarkdown()).toContain('> [!warning]'));
    expect(handleRef.current?.getMarkdown()).toContain('Be careful');
  });

  it('reports the type under the caret when it reopens', async () => {
    // Read through the editor-state subscription, never `isActive` in a render
    // body: `useEditor` does not re-render on transactions in Tiptap v3, so a
    // menu that read `isActive` would open showing whatever was true the last
    // time React happened to render.
    renderEditor('> [!danger] Stop\n>\n> Body.');
    await screen.findByLabelText('Note text');

    const menu = await openCalloutMenu();

    expect(within(menu).getByRole('menuitemradio', { name: 'Danger' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('turns a callout back into a plain quote and keeps the header text', async () => {
    const { handleRef } = renderEditor('> [!danger] Stop\n>\n> Body.');
    await screen.findByLabelText('Note text');

    const menu = await openCalloutMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Quote' }));

    await waitFor(() => expect(handleRef.current?.getMarkdown()).not.toContain('[!danger]'));
    // The header is the user's own text; a menu click must not delete it.
    expect(handleRef.current?.getMarkdown()).toContain('Stop');
  });

  it('closes the colour menu when it opens, so the two never stack', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    await userEvent.click(
      within(bottomToolbar()).getByRole('button', { name: 'Highlight colour' }),
    );
    expect(screen.getByRole('menu', { name: 'Highlight colour' })).toBeInTheDocument();

    await userEvent.click(calloutButton());

    expect(screen.queryByRole('menu', { name: 'Highlight colour' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Callout type' })).toBeInTheDocument();
  });
});

describe('the highlight colour menu', () => {
  async function openColourMenu(): Promise<HTMLElement> {
    await userEvent.click(
      within(bottomToolbar()).getByRole('button', { name: 'Highlight colour' }),
    );
    return screen.getByRole('menu', { name: 'Highlight colour' });
  }

  it('opens from a chevron that reports its own state', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    const chevron = within(bottomToolbar()).getByRole('button', { name: 'Highlight colour' });
    expect(chevron).toHaveAttribute('aria-haspopup', 'menu');
    expect(chevron).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  it('writes the chosen colour into the document as inline HTML', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Blue' }),
    );

    expect(handleRef.current?.getMarkdown()).toBe('<mark class="hl-blue">word</mark>');
  });

  it('leaves the plain == form for the default choice', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Default' }),
    );

    expect(handleRef.current?.getMarkdown()).toBe('==word==');
  });

  it('recolours an existing highlight rather than stacking a second mark', async () => {
    const { handleRef } = renderEditor('==word==');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Pink' }),
    );

    expect(handleRef.current?.getMarkdown()).toBe('<mark class="hl-pink">word</mark>');
  });

  // The case that actually separates `setHighlightColor` from `toggleHighlight`,
  // and the reason the menu does not simply call the toggle.
  //
  // `toggleMark(type, attrs)` decides by `isActive(type, attrs)`. Picking a
  // DIFFERENT colour is therefore already a replace, and a test that only did
  // that passed with the toggle wired in — verified by injecting exactly that
  // fault. Picking the colour that is ALREADY CHECKED is where they diverge:
  // the toggle removes the highlight entirely.
  //
  // Setting is the correct semantics here for the same reason the heading
  // level menu SETS while `Mod-Alt-N` TOGGLES (`markdown-and-schema.md`):
  // these are `menuitemradio`s, and toggling off from a checked radio
  // contradicts the check mark the user is looking at.
  it('leaves the highlight alone when the checked colour is chosen again', async () => {
    const { handleRef } = renderEditor('<mark class="hl-pink">word</mark>');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Pink' }),
    );

    expect(handleRef.current?.getMarkdown()).toBe('<mark class="hl-pink">word</mark>');
  });

  it('leaves a default highlight alone when Default is chosen again', async () => {
    const { handleRef } = renderEditor('==word==');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Default' }),
    );

    expect(handleRef.current?.getMarkdown()).toBe('==word==');
  });

  it('checks the colour the cursor is actually sitting in', async () => {
    const { handleRef } = renderEditor('<mark class="hl-green">word</mark>');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    const menu = await openColourMenu();

    expect(within(menu).getByRole('menuitemradio', { name: 'Green' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  // The whole point of the split control: picking a colour once must not cost
  // a trip through the menu on every subsequent highlight.
  it('makes the Highlight button reuse the last colour chosen', async () => {
    const { handleRef } = renderEditor('one two');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.setTextSelection({ from: 1, to: 4 });
    await userEvent.click(
      within(await openColourMenu()).getByRole('menuitemradio', { name: 'Purple' }),
    );

    handleRef.current?.editor?.commands.setTextSelection({ from: 5, to: 8 });
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Highlight' }));

    expect(handleRef.current?.getMarkdown()).toBe(
      '<mark class="hl-purple">one</mark> <mark class="hl-purple">two</mark>',
    );
  });

  it('closes on Escape without changing the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    await openColourMenu();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Highlight colour' })).toBeNull();
    expect(handleRef.current?.getMarkdown()).toBe('word');
  });

  // `HighlightMenu` (this chevron) and `HighlightPalette` (floats at the
  // caret inside a highlight) are two independent surfaces that both use the
  // string "Highlight colour" as their accessible name. The palette is
  // gated on `contextMenu === null`, but nothing gates it against the
  // toolbar's own colour menu — so with the caret already inside a
  // highlight, opening the chevron's menu risks rendering both at once,
  // which makes `getByRole('menu', { name: 'Highlight colour' })`
  // strict-mode-ambiguous for any test (including every `openColourMenu()`
  // call above) that runs with the caret inside a highlight.
  it('renders exactly one "Highlight colour" surface when the caret is inside a highlight', async () => {
    const { handleRef } = renderEditor('<mark class="hl-green">word</mark>');
    await screen.findByLabelText('Note text');

    // Caret inside the mark, not a selection spanning it — this is what
    // makes `HighlightPalette` pop via `flags.highlightRange`.
    handleRef.current?.editor?.commands.setTextSelection(2);

    await userEvent.click(
      within(bottomToolbar()).getByRole('button', { name: 'Highlight colour' }),
    );

    expect(screen.getAllByRole('menu', { name: 'Highlight colour' })).toHaveLength(1);
  });
});

describe('live formatting state', () => {
  it('repaints the toolbar when the selection moves, with no React state change', async () => {
    // The regression this pins: `useEditor` does not re-render on transactions
    // in Tiptap v3, so a toolbar reading `editor.isActive()` during render
    // reports whatever was true when React last rendered for a reason of its
    // own. Nothing in this test touches React state — the ONLY thing that can
    // repaint the button is the editor-state subscription.
    const { handleRef } = renderEditor('plain **bold** plain');
    await screen.findByLabelText('Note text');
    const editor = handleRef.current?.editor;
    if (editor === null || editor === undefined) {
      throw new Error('editor did not mount');
    }

    const boldButton = within(bottomToolbar()).getByRole('button', { name: 'Bold' });

    act(() => {
      editor.commands.setTextSelection(2);
    });
    await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'false'));

    act(() => {
      editor.commands.setTextSelection(9);
    });
    await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'true'));
  });
});
