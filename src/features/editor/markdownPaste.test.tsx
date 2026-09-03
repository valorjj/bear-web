import { waitFor } from '@testing-library/react';
import { Slice } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

// The user's REAL clipboard, both flavours, captured verbatim on 2026-09-03
// from the Gemini answer whose paste was reported as mangled. Vite `?raw`
// rather than `readFileSync`: the `app` tsconfig project carries no Node
// types on purpose — a `process.env` under `src/` must fail typecheck — and
// the same trick already carries the real stylesheet into `html.test.ts`.
// They live under `src/` rather than beside the ledger because
// `.superpowers/` is gitignored, so a test reading from there would pass here
// and fail in CI with ENOENT.
import GEMINI_HTML from './fixtures/geminiAnswer.html.txt?raw';
import GEMINI_PLAIN from './fixtures/geminiAnswer.plain.txt?raw';

import { normalizeMarkdown } from './markdown';
import { markdownPasteKey } from './MarkdownPaste';
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
 *
 * `getData` answers '' for a type this payload does not carry, and that is
 * load-bearing rather than tidiness. It read
 * `type === 'text/html' ? html : plain` until the whole-branch review, which
 * answered EVERY unrecognised type with the Markdown text — so
 * `@tiptap/extension-code-block`'s handler saw a truthy
 * `vscode-editor-data`, tried to `JSON.parse` the Markdown, and this double
 * concealed the regression where `MarkdownPaste` claimed VS Code pastes that
 * used to become language-tagged fenced blocks. A future handler reading a
 * third clipboard type now gets a truthful answer.
 */
interface Flavours {
  plain?: string;
  html?: string;
  files?: File[];
  /** Any further clipboard type, e.g. `vscode-editor-data`. */
  extra?: Record<string, string>;
}

function clipboardEvent(flavours: Flavours): Event {
  const { plain = '', html = '', files = [], extra = {} } = flavours;
  const types = [
    ...(plain === '' ? [] : ['text/plain']),
    ...(html === '' ? [] : ['text/html']),
    ...Object.keys(extra),
    ...(files.length === 0 ? [] : ['Files']),
  ];
  const data: Record<string, string> = { 'text/plain': plain, 'text/html': html, ...extra };
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      types,
      items: [],
      getData: (type: string) => data[type] ?? '',
    },
  });
  return event;
}

function paste(flavours: Flavours): boolean {
  const event = clipboardEvent(flavours);
  // The FIRST `.ProseMirror` in the document, so a test that mounts two
  // editors pastes into the wrong one. One editor per test.
  document.querySelector('.ProseMirror')!.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Whether `MarkdownPaste`'s OWN handler claims a payload.
 *
 * `paste()` returns `event.defaultPrevented`, which cannot answer that
 * question and it is worth saying why rather than rediscovering it.
 * ProseMirror's `doPaste` calls every `handlePaste` in turn and then, if they
 * all declined, inserts the clipboard ITSELF and calls `preventDefault`
 * anyway — so from outside, a declined paste is indistinguishable from a
 * claimed one. Measured: a whitespace-only payload, a paste into a code block
 * and a `vscode-editor-data` paste all report `defaultPrevented === true`
 * whether this plugin's guards are present or not. Asking the plugin directly
 * is the only faithful instrument for "this handler stayed out of the way".
 */
function claimedByMarkdownPaste(
  handleRef: React.RefObject<RichEditorHandle | null>,
  flavours: Flavours,
): boolean {
  const view = handleRef.current!.editor!.view;
  const plugin = markdownPasteKey.get(view.state)!;
  const handlePaste = plugin.props.handlePaste!;
  return (
    handlePaste.call(plugin, view, clipboardEvent(flavours) as ClipboardEvent, Slice.empty) === true
  );
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
  //
  // What this catches, measured rather than assumed: replacing the
  // parse-and-insert-a-slice body with `tr.insertText(text)` — the
  // pre-N behaviour — fails all ten of these and none of the other
  // tests in this file.
  //
  // What it does NOT catch, also measured: forcing `sliceFor` to always
  // return open depth 1 leaves all ten passing. These paste into an EMPTY
  // note, where there is nothing to merge with, so ProseMirror's slice
  // fitting just repairs the unsatisfiable openness. Slice depth is the
  // job of the two mid-sentence tests above, not of this one.
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
  it('leaves a paste inside a code block alone, so a snippet is not eaten as Markdown', async () => {
    // THE CRITICAL REGRESSION GUARD. A code block takes clipboard text
    // verbatim — ProseMirror's `parseFromClipboard` has an `inCode` branch for
    // it — and claiming the event bypassed that branch entirely: the `#` and
    // `-` below were consumed as Markdown, an H1 and a bullet list appeared
    // after the fence, and with the caret mid-block the fence was SPLIT IN
    // TWO. Any shell, Python, YAML or Markdown snippet pasted into a fence was
    // corrupted.
    const handleRef = await mounted('```ts\nconst a = 1;\n```');
    // Mid-block, which is the worse of the two positions: the end-of-block
    // case merely mangles the text, this one splits the node.
    handleRef.current!.editor!.commands.setTextSelection(5);

    expect(claimedByMarkdownPaste(handleRef, { plain: '# comment\n- item' })).toBe(false);
    paste({ plain: '# comment\n- item' });

    await waitFor(() => {
      // Byte-identical to pre-N: the text lands verbatim, inside the fence.
      expect(handleRef.current!.getMarkdown()).toBe(
        '```ts\ncons# comment\n- itemt a = 1;\n```\n\n',
      );
    });
    const kinds: string[] = [];
    handleRef.current!.editor!.state.doc.descendants((node) => {
      kinds.push(node.type.name);
    });
    // Stated as counts and absences rather than left to the string above, so
    // the split-in-two symptom fails BY NAME rather than as a diff to read.
    expect(kinds.filter((kind) => kind === 'codeBlock')).toHaveLength(1);
    expect(kinds).not.toContain('heading');
    expect(kinds).not.toContain('bulletList');
  });

  it('leaves a VS Code paste to the code-block handler, which tags its language', async () => {
    // `@tiptap/extension-code-block`'s `codeBlockVSCodeHandler` reads
    // `vscode-editor-data` and builds a fence tagged with the source language,
    // which beats parsing the same text as Markdown. It is ALSO a
    // `handlePaste`, and although `MarkdownPaste` sits later in the extensions
    // array its plugin runs first — Tiptap's plugin order is not the array's —
    // so this paste became an H1 and a paragraph until the explicit guard went
    // in. No array position would have fixed it.
    const handleRef = await mounted();

    expect(
      claimedByMarkdownPaste(handleRef, {
        plain: '# comment\nprint(1)',
        extra: { 'vscode-editor-data': '{"mode":"python"}' },
      }),
    ).toBe(false);
    paste({
      plain: '# comment\nprint(1)',
      extra: { 'vscode-editor-data': '{"mode":"python"}' },
    });

    await waitFor(() => {
      // A python-tagged fence, with the `#` still a comment rather than an H1.
      expect(handleRef.current!.getMarkdown()).toBe('```python\n# comment\nprint(1)\n```\n\n');
    });
  });

  it('leaves the reported Gemini clipboard to ProseMirror, whose HTML is faithful', async () => {
    // THE REPORTED DEFECT, from the user's real clipboard, both flavours
    // committed verbatim as fixtures.
    //
    // The plain flavour wraps the whole answer in a ```markdown fence, and the
    // answer itself contains a NESTED fence — fences land on lines 5, 63, 69
    // and 93, so the inner one closes the outer one early. Parsing it yields 3
    // paragraphs and 2 code blocks with an ASCII diagram stranded between
    // them. The HTML flavour of the same clipboard describes `pre` twice and
    // no headings, lists or tables at all, so ProseMirror's own HTML path
    // renders prose plus one clean code block — which is what the source
    // meant.
    const handleRef = await mounted();

    expect(claimedByMarkdownPaste(handleRef, { plain: GEMINI_PLAIN, html: GEMINI_HTML })).toBe(
      false,
    );
  });

  it('leaves a copied paragraph to ProseMirror, so its link survives', async () => {
    // The plain flavour carries no link at all — only the HTML does. Claiming
    // this paste would drop it silently, which is why `<a>` counts as
    // structure.
    const handleRef = await mounted();

    expect(
      claimedByMarkdownPaste(handleRef, {
        plain: 'Read the announcement for details.',
        html: '<p>Read <a href="https://example.com">the announcement</a> for details.</p>',
      }),
    ).toBe(false);
  });

  it('still parses a plain-only Markdown clipboard, which is the original bug', async () => {
    // No `text/html` at all — a Copy button, a terminal, a `.md` file in a
    // plain editor. This is the case N shipped for and it must keep working.
    const handleRef = await mounted();

    expect(claimedByMarkdownPaste(handleRef, { plain: '## Heading\n\n- one\n- two' })).toBe(true);
    paste({ plain: '## Heading\n\n- one\n- two' });

    await waitFor(() => {
      const kinds: string[] = [];
      handleRef.current!.editor!.state.doc.descendants((node) => {
        kinds.push(node.type.name);
      });
      expect(kinds).toContain('heading');
      expect(kinds).toContain('bulletList');
    });
  });

  it('parses a clipboard whose HTML is only wrappers, dressed-up plain text', async () => {
    // `div` and `span` declare nothing the plain text has lost, so the
    // Markdown reading is the better one.
    const handleRef = await mounted();

    expect(
      claimedByMarkdownPaste(handleRef, {
        plain: '## Heading',
        html: '<div><span>## Heading</span></div>',
      }),
    ).toBe(true);
    paste({ plain: '## Heading', html: '<div><span>## Heading</span></div>' });

    await waitFor(() => {
      const kinds: string[] = [];
      handleRef.current!.editor!.state.doc.descendants((node) => {
        kinds.push(node.type.name);
      });
      expect(kinds).toContain('heading');
    });
  });

  it('does not claim a whitespace-only paste, which would swallow the characters', async () => {
    // `'   '` and `'\n'` parse to one empty paragraph, whose inline slice
    // inserts NOTHING — so claiming the event suppressed the browser and the
    // characters vanished. They landed before N, and they land again.
    const handleRef = await mounted('ab');
    handleRef.current!.editor!.commands.setTextSelection(2);

    expect(claimedByMarkdownPaste(handleRef, { plain: '   ' })).toBe(false);
    expect(claimedByMarkdownPaste(handleRef, { plain: '\n' })).toBe(false);
    paste({ plain: '   ' });

    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).toBe('a   b');
    });
  });
});
