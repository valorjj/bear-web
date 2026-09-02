import { waitFor } from '@testing-library/react';
import { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { normalizeMarkdown } from './markdown';
import { RichEditor, type RichEditorHandle } from './RichEditor';

// jsdom has no layout engine, so ProseMirror's `coordsAtPos`/`posAtCoords`
// throw on APIs it never implements. These three stubs are what let a Vitest
// test drive the editor's real surface at all; copied from
// `imagePaste.test.tsx`, which documents them at length.
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

// The paste dispatch ends in `tr.scrollIntoView()`, and the view answers that
// by calling `scrollToSelection`, which jsdom cannot do. It only moves the
// viewport — never the document — so stubbing it changes nothing this file
// asserts. `scrollToSelection` is public at runtime but typed internal, hence
// the cast; the same move `toolbars.test.tsx` makes.
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
  initialMarkdown = '',
  onImage?: (file: Blob) => Promise<string | null>,
): React.RefObject<RichEditorHandle | null> {
  const handleRef = createRef<RichEditorHandle>();
  renderWithI18n(
    <RichEditor
      initialMarkdown={initialMarkdown}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      ariaLabel="Note text"
      handleRef={handleRef}
      createdAt={0}
      updatedAt={0}
      onImage={onImage}
    />,
  );
  return handleRef;
}

/**
 * A paste carrying text flavours, dispatched at the editor's surface.
 *
 * jsdom implements neither `DataTransfer` nor a `ClipboardEvent` that accepts
 * one, so the payload is attached by hand — and `getData` is MANDATORY, not a
 * courtesy. `@tiptap/core`'s own `handleDOMEvents.paste` calls it before ours
 * is reached, and the throw from a missing `getData` stops our handler running
 * at all, presenting as "my plugin does nothing" rather than as an error. That
 * cost a stack trace to diagnose once already.
 */
function paste(flavours: { plain?: string; html?: string; files?: File[] }): boolean {
  const { plain = '', html = '', files = [] } = flavours;
  const types = [
    ...(plain === '' ? [] : ['text/plain']),
    ...(html === '' ? [] : ['text/html']),
    ...(files.length === 0 ? [] : ['Files']),
  ];
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      types,
      items: [],
      getData: (type: string) => (type === 'text/html' ? html : plain),
    },
  });
  document.querySelector('.ProseMirror')!.dispatchEvent(event);
  return event.defaultPrevented;
}

async function mounted(initialMarkdown = '', onImage?: (file: Blob) => Promise<string | null>) {
  const handleRef = renderEditor(initialMarkdown, onImage);
  await waitFor(() => expect(handleRef.current).not.toBeNull());
  return handleRef;
}

describe('MarkdownPaste', () => {
  it('parses a pasted heading and list into real nodes', async () => {
    const handleRef = await mounted();

    paste({ plain: '## Weekly report\n\n- one\n- two' });

    await waitFor(() => {
      // The trailing `\n\n` is StarterKit's `TrailingNode` affordance, not a
      // defect: a block-level paste appends ONE empty paragraph so the user
      // can put the caret below the block they just pasted. Measured: every
      // block paste adds exactly this and nothing more, and opening a note
      // containing the same Markdown adds none, so the two legitimately
      // differ by it.
      expect(handleRef.current!.getMarkdown()).toBe('## Weekly report\n\n- one\n- two\n\n');
    });
  });

  it('parses a pasted table into a table, not a paragraph per row', async () => {
    const handleRef = await mounted();

    paste({ plain: '| a | b |\n| --- | --- |\n| 1 | 2 |' });

    await waitFor(() => {
      // Columns come back padded, which is the serializer's normal form —
      // proof this became a real table node rather than three paragraphs.
      expect(handleRef.current!.getMarkdown()).toBe(
        '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n',
      );
    });
  });

  it('inserts a single paragraph INLINE, without splitting the one it lands in', async () => {
    // Slice open depth. With `openStart`/`openEnd` of 0 this pastes a new
    // block and the sentence breaks in half.
    const handleRef = await mounted('start end');
    // The caret is placed through a command, NEVER a click: jsdom stubs
    // `document.elementFromPoint` to null and every Range rect is zero, so
    // ProseMirror's `posAtCoords` resolves nothing and a test that assumes
    // where a click left the caret fails rarely and confusingly.
    handleRef.current!.editor!.commands.setTextSelection(6);

    paste({ plain: '**bold**' });

    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).not.toContain('\n\n');
    });
    expect(handleRef.current!.getMarkdown()).toContain('**bold**');
  });

  it('inserts a pasted heading as a BLOCK, splitting the paragraph around it', async () => {
    // The counter-case to the test above, and the reason `sliceFor` keys on
    // the node being a `paragraph` rather than on `isTextblock`. At open
    // depth 1 this heading's text would merge into the surrounding paragraph
    // and the heading would be lost; at depth 0 the sentence splits around it
    // and it survives. Without this test, "simplifying" that check to
    // `isTextblock` passes the whole suite.
    const handleRef = await mounted('start end');
    handleRef.current!.editor!.commands.setTextSelection(6);

    paste({ plain: '## Hi' });

    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).toBe('start\n\n## Hi\n\n end');
    });
  });

  it('claims the paste, so the browser does not also insert the raw text', async () => {
    await mounted();
    expect(paste({ plain: '## heading' })).toBe(true);
  });

  it('ignores an empty clipboard, so nothing is claimed for no reason', async () => {
    await mounted();
    expect(paste({})).toBe(false);
  });

  it('leaves an image paste to ImagePaste', async () => {
    // THE ORDERING PROOF. `ImagePaste` claims image pastes through
    // `handleDOMEvents.paste`, which ProseMirror consults BEFORE `handlePaste`
    // — so `MarkdownPaste` must never see this event. If this fails, the whole
    // "no ordering dependency between the two extensions" claim is wrong and
    // Task 3's design note must be revisited before going further.
    const onImage = vi.fn(async () => 'files/abc.webp');
    const handleRef = await mounted('', onImage);

    paste({
      plain: '## not a heading, this is an image paste',
      files: [new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })],
    });

    await waitFor(() => expect(onImage).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).toContain('![](files/abc.webp)');
    });
    expect(handleRef.current!.getMarkdown()).not.toContain('## not a heading');
  });

  // Pasting `m` into an EMPTY note must land the same document that opening a
  // note containing `m` lands. One assertion, every construct — and the only
  // thing here that can catch a slice-depth or sanitisation mistake on a shape
  // nobody thought to pin individually.
  it.each([
    ['a heading', '## Weekly report'],
    ['a list', '- one\n- two'],
    ['an ordered list', '1. one\n2. two'],
    ['a table', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['a fenced code block', '```ts\nconst a = 1;\n```'],
    ['a blockquote', '> quoted'],
    ['inline marks', 'some **bold** and *em* text'],
    ['a link', 'see [the docs](https://example.com)'],
    ['several blocks', '# Title\n\nA paragraph.\n\n- one\n- two'],
    ['a task list', '- [ ] todo\n- [x] done'],
  ])(
    'pasting %s into an empty note matches opening a note that contains it',
    async (_label, markdown) => {
      const handleRef = await mounted();

      paste({ plain: markdown });

      await waitFor(() => {
        const opened = normalizeMarkdown(markdown);
        const pasted = handleRef.current!.getMarkdown();
        // Exactly two legal outcomes, and nothing between them. An inline paste
        // (a single paragraph, open depth 1) is byte-identical to opening the
        // note. A block-level paste additionally carries ONE empty paragraph
        // from StarterKit's `TrailingNode`, so the caret has somewhere to go
        // below the pasted block. Asserting membership rather than trimming
        // keeps this non-vacuous: two blank paragraphs fail, lost content
        // fails, and a table flattened into a paragraph fails.
        expect([opened, opened + '\n\n']).toContain(pasted);
      });
    },
  );
});
