# N — Paste Markdown as Markdown: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting Markdown into a note produces the structure it describes — headings, tables, lists, marks — instead of literal characters.

**Architecture:** A new Tiptap extension `MarkdownPaste` registers a ProseMirror `handlePaste` prop that reads `text/plain` off the clipboard, decodes the HTML entities the Markdown parser does not, runs the existing `parseMarkdown`, and inserts the result as a `Slice`. Two pure helpers live in their own module so the decision logic is unit-testable without ProseMirror. `ImagePaste` keeps claiming image pastes through the earlier-running `handleDOMEvents.paste` hook, so the two extensions never contend.

**Tech Stack:** TypeScript 6 (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`), Tiptap v3 / ProseMirror, Vitest + jsdom + `@testing-library/react`, Playwright, oxlint, Prettier.

**Spec:** `docs/superpowers/specs/2026-09-02-n-paste-markdown-design.md`

## Global Constraints

- **No new dependency.** `scripts/bundleSize.test.ts` reports **1,884 B** of headroom on the eager chunk. An entity-decoding package does not fit; decoding goes through a detached `<textarea>`.
- **`markdown.ts` is the only importer of `@tiptap/markdown`.** `MarkdownPaste` imports `parseMarkdown` from `./markdown`, never the package.
- **No hardcoded user-facing strings.** N ships no UI, so `src/i18n/en.ts` and `ko.ts` are untouched. If you find yourself adding a key, stop — that is out of scope.
- **Every colour from a CSS custom property.** N adds no styles at all.
- **Duck-type in tests, never `instanceof`.** `vitest.setup.ts` swaps the global `Blob` for Node's.
- **Six gates must pass before any commit:** `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`, `npm run test:e2e`, `npm run build`. Per `CLAUDE.md`'s cost rules, per-task commits run the **cheap tier** (`typecheck`, `lint`, `format`) plus the **scoped** test file; the full unit suite and e2e run at the gate boundaries named in Task 7 only.
- **`npm run measure:check` is NOT required.** N changes no geometry, no typography and no chrome. Do not regenerate `measurements.md`.
- **Repetition targets files, never the suite.** A single file is `npx vitest run <path>` (~2-3s); the full suite is ~80 CPU-seconds on a fanless Mac Mini that also hosts the API service. Cap workers with `--maxWorkers=4` if you must run everything.
- **Before trusting any e2e result that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is silently reused and the suite then tests an old build.
- **Every new test must be demonstrated failing** against a deliberately broken implementation before it is trusted. Sub-project H produced three assertions that passed against sabotaged code.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `src/features/editor/pastedMarkdown.ts` | Two pure functions: `looksLikeMarkdown`, `decodeEntities`. No ProseMirror, no clipboard, no DOM event. |
| Create `src/features/editor/pastedMarkdown.test.ts` | Table-driven unit tests for both. Where the bugs are. |
| Create `src/features/editor/MarkdownPaste.ts` | The extension: the `handlePaste` prop, the flavour decision, slice construction, dispatch. |
| Create `src/features/editor/markdownPaste.test.ts` | Synthesised paste against a mounted `RichEditor`, plus the ordering proof and the round-trip invariant. |
| Create `e2e/pasteMarkdown.spec.ts` | The only place a real two-flavour clipboard exists. |
| Modify `src/features/editor/extensions.ts` | Register `MarkdownPaste` in `buildEditorExtensions`. |
| Modify `docs/rulings/markdown-and-schema.md` | Four new rulings, and its `**Trigger:**` line. |
| Modify `CLAUDE.md` | Correct the "typing Markdown does not parse it" bullet; add the status row. |
| Modify `docs/superpowers/NEXT.md` | N shipped; record the two out-of-scope residue items. |

---

### Task 1: `looksLikeMarkdown`

The detector that chooses between `text/html` and `text/plain` when the clipboard carries both. **It gates nothing else** — a plain-text-only clipboard is always parsed, per the spec's decision 1.

**Files:**

- Create: `src/features/editor/pastedMarkdown.ts`
- Test: `src/features/editor/pastedMarkdown.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function looksLikeMarkdown(text: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/pastedMarkdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { looksLikeMarkdown } from './pastedMarkdown';

describe('looksLikeMarkdown', () => {
  // Used ONLY to choose between two structured readings of the same
  // clipboard — never between structure and literal characters. Being wrong
  // here costs formatting fidelity, not a mangled document.
  it.each([
    ['a fenced code block', '```ts\nconst a = 1;\n```'],
    ['a tilde fence', '~~~\nplain\n~~~'],
    ['a table delimiter row', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['a compact table delimiter row', '|a|b|\n|---|---|\n|1|2|'],
    ['an aligned table delimiter row', '| a | b |\n| :--- | ---: |\n| 1 | 2 |'],
    ['an ATX heading', '## Weekly report'],
    ['a deep ATX heading', '###### small'],
    ['a dash list', '- one\n- two'],
    ['a star list', '* one\n* two'],
    ['a plus list', '+ one\n+ two'],
    ['an ordered list', '1. one\n2. two'],
    ['a parenthesised ordered list', '1) one\n2) two'],
    ['a blockquote', '> quoted'],
    ['a link', 'see [the docs](https://example.com) for more'],
    ['an image', '![shot](files/a.webp)'],
    ['a heading after a blank first line', '\n\n## later'],
    ['an indented heading', '   ### three spaces is still a heading'],
  ])('recognises %s', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['ordinary prose', 'A paragraph of prose with no markers at all.'],
    ['prose with a stray underscore', 'the file_name is here'],
    ['prose with a mid-line hash', 'issue #42 is open'],
    ['prose with a mid-line dash', 'well - maybe not'],
    // DELIBERATELY not a signal. A rich source's text/html renders these
    // faithfully, and asterisks in a plain-text flavour are weaker evidence
    // than any structural marker.
    ['emphasis alone', '**bold** and _em_ and nothing else'],
    ['an over-indented heading', '    # four spaces is a code block, not a heading'],
    ['an over-indented list', '     - four spaces in'],
    ['a hash with no space', '#tag'],
    ['a table-ish line with no dashes', '| a | b |'],
    ['a dash rule with no pipe', '-----'],
    ['the empty string', ''],
  ])('does not recognise %s', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
```

Note two of the negatives, because they are the ones an implementation gets wrong by accident. `'#tag'` must not match — this app's own tag syntax is a hash with no space, and treating it as a heading would misread a note's own tags. `'| a | b |'` must not match without a delimiter row, or any prose containing a pipe becomes a table.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts`
Expected: FAIL — `Failed to resolve import "./pastedMarkdown"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/editor/pastedMarkdown.ts`:

```ts
/**
 * Pure helpers for the paste path. No ProseMirror, no clipboard, no event —
 * which is the point: this is where the decisions live, so this is where the
 * tests can be exhaustive and cheap.
 */

/**
 * Structural Markdown markers. Any ONE is enough.
 *
 * `^ {0,3}` on every line-anchored pattern is CommonMark's rule, not a
 * courtesy: four spaces of indent makes an indented code block, at which
 * point the marker is content rather than syntax.
 *
 * Emphasis (`**bold**`, `_em_`) is deliberately absent. See the docblock on
 * `looksLikeMarkdown`.
 */
const SIGNALS: readonly RegExp[] = [
  /^ {0,3}(?:```|~~~)/m,
  /^ {0,3}#{1,6} /m,
  /^ {0,3}(?:[-*+] |\d{1,9}[.)] )/m,
  /^ {0,3}> /m,
  /!?\[[^\]]*\]\([^)]*\)/,
];

/**
 * A table's delimiter row — the line of dashes under the header.
 *
 * Not a regex in `SIGNALS` because it is genuinely two conditions: the line
 * must be built only of table punctuation AND carry a run of dashes. A single
 * pattern for that is unreadable, and the failure mode of getting it wrong is
 * that any prose containing a pipe becomes a table.
 */
function hasTableDelimiterRow(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.includes('|') && /^[|:\-\s]+$/.test(trimmed) && /-{3,}/.test(trimmed);
  });
}

/**
 * Whether pasted text carries enough structure to be worth reading as
 * Markdown INSTEAD of an accompanying `text/html` flavour.
 *
 * This is the ONLY question this function answers, and the distinction
 * matters. A clipboard with no HTML flavour is always parsed as Markdown —
 * `MarkdownPaste` does not consult this — because the app is Markdown and a
 * rule the user cannot predict is worse than one that is occasionally wrong.
 * Here the choice is between two STRUCTURED readings of the same content, so
 * a wrong answer costs formatting fidelity rather than mangling a document.
 */
export function looksLikeMarkdown(text: string): boolean {
  return SIGNALS.some((signal) => signal.test(text)) || hasTableDelimiterRow(text);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Prove the test can fail**

Temporarily replace the body of `looksLikeMarkdown` with `return true;`.

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts`
Expected: FAIL — all 11 negative cases. Then restore the real body and confirm PASS again.

This is not ceremony: a detector that always says yes is exactly the bug that turns decision 2 back into "plain text always wins", and it would pass a suite made only of positive cases.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor/pastedMarkdown.ts src/features/editor/pastedMarkdown.test.ts
git commit -m "feat(n): recognise structural Markdown in pasted text"
```

---

### Task 2: `decodeEntities`

**Files:**

- Modify: `src/features/editor/pastedMarkdown.ts`
- Test: `src/features/editor/pastedMarkdown.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function decodeEntities(text: string): string`

**Why this exists, measured rather than assumed.** `parseMarkdown` decodes exactly `&amp;` `&lt;` `&gt;` `&quot;` and nothing else. `&nbsp;`, `&mdash;`, `&rsquo;`, `&copy;`, `&hellip;`, `&apos;`, `&#160;` and `&#x2014;` all survive as literal text — and gain an `&amp;` on the way back out, so the note is permanently wrong. Those are precisely what a rich web source emits. The full measurement table is in the spec.

- [ ] **Step 1: Write the failing test**

Append to `src/features/editor/pastedMarkdown.test.ts` (and add `decodeEntities` to the import at the top):

```ts
describe('decodeEntities', () => {
  it.each([
    ['a non-breaking space', 'a&nbsp;b', 'a b'],
    ['an em dash', 'a&mdash;b', 'a—b'],
    ['a right single quote', 'don&rsquo;t', 'don’t'],
    ['an ellipsis', 'wait&hellip;', 'wait…'],
    ['a copyright sign', '&copy; 2026', '© 2026'],
    ['an apostrophe', 'don&apos;t', "don't"],
    ['a decimal reference', 'a&#160;b', 'a b'],
    ['a hex reference', 'a&#x2014;b', 'a—b'],
    ['an uppercase hex reference', 'a&#X2014;b', 'a—b'],
    ['several in one string', '&copy;&nbsp;&mdash;', '© —'],
  ])('decodes %s', (_label, input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  // The four the Markdown parser decodes ITSELF. Decoding them here too is a
  // double-decode: `&amp;amp;` must reach the parser intact so it becomes the
  // text `&amp;`, not `&`. And `&lt;div&gt;` must keep reaching the parser as
  // an entity pair, because the parser decodes it and then claims `<div>` as a
  // raw-HTML node — changing that would be a silent schema surprise.
  it.each([
    ['ampersand', 'AT&amp;T'],
    ['less-than', '&lt;div&gt;'],
    ['greater-than', '&gt; quoted'],
    ['double quote', '&quot;quoted&quot;'],
    ['a doubly-escaped ampersand', '&amp;amp;'],
    ['a doubly-escaped nbsp', '&amp;nbsp;'],
  ])('leaves %s untouched for the parser', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it.each([
    ['text with no ampersand at all', 'plain text'],
    ['a bare ampersand', 'Tom & Jerry'],
    ['an unterminated reference', 'a &nbsp b'],
    ['an unknown named reference', 'a &notareal; b'],
    ['an empty reference', 'a &; b'],
    ['the empty string', ''],
  ])('returns %s unchanged', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it('decodes an uppercase alias the parser does not handle', () => {
    // `&AMP;` is a legacy HTML alias the Markdown parser does NOT decode, so
    // skipping it here would leave it literal and let it gain an `&amp;` on
    // the way out. The exclusion list is therefore matched case-SENSITIVELY,
    // against exactly the four spellings the parser handles.
    expect(decodeEntities('a &AMP; b')).toBe('a & b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts -t decodeEntities`
Expected: FAIL — `decodeEntities is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/features/editor/pastedMarkdown.ts`:

```ts
/**
 * The four references `parseMarkdown` decodes itself, in exactly the spellings
 * it handles. Matched case-sensitively on purpose: `&AMP;` is a legacy alias
 * the parser does NOT decode, so it must fall through and be decoded here.
 */
const PARSER_HANDLED: ReadonlySet<string> = new Set(['amp', 'lt', 'gt', 'quot']);

/** Named, decimal and hexadecimal character references. */
const REFERENCE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decoded values, keyed by the reference as written.
 *
 * The decode itself needs a DOM element, and a large paste can carry hundreds
 * of references — most of them the same one. The cache keeps this one element
 * creation per DISTINCT reference rather than per occurrence.
 */
const decoded = new Map<string, string | null>();

/**
 * Decodes one reference, or `null` if the browser does not recognise it.
 *
 * A `<textarea>` rather than a library: `scripts/bundleSize.test.ts` leaves
 * 1,884 B of headroom on the eager chunk, which an entity package does not
 * fit into, and the DOM already carries the full table.
 *
 * A textarea SPECIFICALLY, because its content model is RCDATA: assigning
 * `innerHTML` decodes character references without parsing tags, so there is
 * no path to script execution even though the text came off a clipboard.
 */
function decodeReference(reference: string): string | null {
  const cached = decoded.get(reference);
  if (cached !== undefined) return cached;

  const probe = document.createElement('textarea');
  probe.innerHTML = reference;
  // Unrecognised references come back verbatim, which is indistinguishable
  // from "decoded to itself" — no reference decodes to itself, so equality
  // means the browser did not know it.
  const value = probe.value === reference ? null : probe.value;

  decoded.set(reference, value);
  return value;
}

/**
 * Decodes the HTML character references `parseMarkdown` does not.
 *
 * Applied on the PASTE path only, never to a note already on disk. A paste is
 * an import; typing is authoring. Fixing this inside `markdown.ts` would also
 * repair typed and existing notes, but it edits the one component whose
 * failure corrupts notes silently — see the spec's decision 3.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(REFERENCE, (match, body: string) => {
    if (PARSER_HANDLED.has(body)) return match;
    return decodeReference(match) ?? match;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the exclusion list is load-bearing**

Temporarily change `PARSER_HANDLED` to an empty `new Set([])`.

Run: `npx vitest run src/features/editor/pastedMarkdown.test.ts -t 'untouched for the parser'`
Expected: FAIL on all six cases — `&amp;amp;` collapses to `&amp;`, `&lt;div&gt;` becomes `<div>`. Restore and confirm PASS.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor/pastedMarkdown.ts src/features/editor/pastedMarkdown.test.ts
git commit -m "feat(n): decode the entities the Markdown parser leaves literal"
```

---

### Task 3: The extension, and proving it never fights `ImagePaste`

The design rests on an ordering claim: `ImagePaste` uses `handleDOMEvents.paste`, ProseMirror consults that **before** `handlePaste`, so an image paste never reaches `MarkdownPaste`. **That claim is verified here by injection, not by reading ProseMirror's documentation.** If it turns out false, the fallback is a single `handleDOMEvents.paste` registered after `ImagePaste`'s, which must then sniff `clipboardData.files` itself — do not proceed past Step 2 without knowing which world you are in.

**Files:**

- Create: `src/features/editor/MarkdownPaste.ts`
- Create: `src/features/editor/markdownPaste.test.ts`
- Modify: `src/features/editor/extensions.ts`

**Interfaces:**

- Consumes: `looksLikeMarkdown(text: string): boolean` and `decodeEntities(text: string): string` from `./pastedMarkdown`; `parseMarkdown(markdown: string): JSONContent` from `./markdown`.
- Produces: `export const MarkdownPaste: Extension` and `export const markdownPasteKey: PluginKey`. It takes **no options** — see Step 3.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/markdownPaste.test.ts`:

```ts
import { waitFor } from '@testing-library/react';
import { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

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
      expect(handleRef.current!.getMarkdown()).toBe('## Weekly report\n\n- one\n- two');
    });
  });

  it('parses a pasted table into a table, not a paragraph per row', async () => {
    const handleRef = await mounted();

    paste({ plain: '| a | b |\n| --- | --- |\n| 1 | 2 |' });

    await waitFor(() => {
      // Columns come back padded, which is the serializer's normal form —
      // proof this became a real table node rather than three paragraphs.
      expect(handleRef.current!.getMarkdown()).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |');
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
});
```

- [ ] **Step 2: Run the test to verify it fails, and read WHICH way it fails**

Run: `npx vitest run src/features/editor/markdownPaste.test.ts`

Expected: FAIL — `Failed to resolve import "./MarkdownPaste"` is not yet the failure, since the test imports only `RichEditor`. The real expected failures are the six assertions: pasted text arrives verbatim (`## Weekly report` stays literal), and `paste(...)` returns `false`.

**The `leaves an image paste to ImagePaste` case should PASS already** — nothing yet competes with `ImagePaste`. It becomes meaningful in Step 5.

- [ ] **Step 3: Write the extension**

Create `src/features/editor/MarkdownPaste.ts`:

```ts
import { Extension } from '@tiptap/core';
import { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { parseMarkdown } from './markdown';
import { decodeEntities, looksLikeMarkdown } from './pastedMarkdown';

export const markdownPasteKey = new PluginKey('markdownPaste');

/**
 * How deeply open the pasted slice is at each end.
 *
 * A result that is exactly ONE paragraph inserts inline — open depth 1 — so
 * pasting `**bold**` into the middle of a sentence marks up the sentence
 * instead of splitting it in two. Anything else inserts as blocks.
 *
 * `paragraph` specifically, not `isTextblock`: pasting `## Hi` mid-sentence
 * should produce a heading, and open depth 1 would merge its text into the
 * surrounding paragraph and lose the heading entirely.
 */
function sliceFor(doc: ProseMirrorNode): Slice {
  const inline = doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph';
  return inline ? new Slice(doc.content, 1, 1) : new Slice(doc.content, 0, 0);
}

/**
 * Pasting Markdown into a note.
 *
 * The app IS Markdown — every note is loaded with `parseMarkdown` and saved by
 * serializing back — but until this existed there was no paste path into that
 * parser, so `**bold**` arrived as five literal characters and a table arrived
 * as one paragraph per row.
 *
 * Registered UNCONDITIONALLY, unlike `ImagePaste`. It has no options and no
 * callback: it depends on nothing but the clipboard and the schema, so there
 * is no "wired up or not" state to express — which is exactly what
 * `ImagePaste.onImage === null` exists for.
 *
 * `handlePaste`, not `handleDOMEvents.paste`, and that does real work.
 * `ImagePaste` claims image pastes through `handleDOMEvents.paste` and calls
 * `preventDefault`, and ProseMirror consults `handleDOMEvents` BEFORE
 * `handlePaste` — so an image paste never reaches this plugin. No duplicated
 * file-sniffing, and no ordering dependency between the two entries in
 * `buildEditorExtensions`. Verified by injection in `markdownPaste.test.ts`,
 * not inferred from ProseMirror's documentation.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: markdownPasteKey,
        props: {
          handlePaste(view, event) {
            // ProseMirror synthesises a paste from a hidden element on
            // browsers that withhold `clipboardData`. Nothing to read, so
            // leave the event alone.
            const clipboard = event.clipboardData ?? null;
            if (clipboard === null) return false;

            const text = clipboard.getData('text/plain');
            if (text === '') return false;

            // A rich source offers both flavours. Plain text wins only when it
            // carries structure — otherwise ProseMirror's own HTML path runs,
            // so copying a paragraph with a link off a web page keeps the
            // link. See the spec's decision 2.
            const html = clipboard.getData('text/html');
            if (html !== '' && !looksLikeMarkdown(text)) return false;

            const doc = ProseMirrorNode.fromJSON(
              view.state.schema,
              parseMarkdown(decodeEntities(text)),
            );

            // Through the view's own state and dispatch, NEVER
            // `editor.commands.*`: a command opens its own outer transaction,
            // and dispatching inside one throws `RangeError: Applying a
            // mismatched transaction`.
            view.dispatch(view.state.tr.replaceSelection(sliceFor(doc)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
```

- [ ] **Step 4: Register it**

In `src/features/editor/extensions.ts`, add the import beside the `ImagePaste` one (line 19):

```ts
import { MarkdownPaste } from './MarkdownPaste';
```

and add the entry inside `buildEditorExtensions`'s returned array, immediately after the `ImagePaste.configure(...)` line:

```ts
    ImagePaste.configure({ onImage: options.onImage ?? null }),
    // No `.configure`: `MarkdownPaste` takes no options, so it is identical in
    // `editorExtensions` and in the app's own build.
    MarkdownPaste,
```

Do **not** add anything to `buildEditorExtensions`'s options type — there are no options, and `CLAUDE.md` records that extension options are a flat merge where a colliding name silently loses.

Nothing to add to `src/features/editor/index.ts`. Verified while planning: that barrel does not re-export `ImagePaste` either — extensions reach the editor only through `buildEditorExtensions`, and adding a second route in would be a new pattern, not consistency with an existing one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/markdownPaste.test.ts`
Expected: PASS, 6 tests — including the ordering proof, which is now meaningful because there IS a competing handler.

If `leaves an image paste to ImagePaste` fails here, **stop and report**. The ordering claim is false, and the fix is to convert `handlePaste` into a `handleDOMEvents.paste` registered after `ImagePaste`'s that returns `false` when `clipboardData.files` contains an `image/*` entry. Do not paper over it by reordering the extension array.

If `inserts a single paragraph INLINE` fails, the open depth in `sliceFor` is the suspect and nothing else is.

- [ ] **Step 6: Prove the flavour gate is load-bearing**

Temporarily delete the two `html` lines from `handlePaste`.

Run: `npx vitest run src/features/editor/markdownPaste.test.ts`
Expected: still PASS — jsdom's synthesised clipboard cannot exercise this, which is precisely why Task 6 exists. Restore the lines. Record this outcome in the ledger: an injection that provably cannot fail at this layer is a finding about coverage, not a passing test.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor/MarkdownPaste.ts src/features/editor/markdownPaste.test.ts \
        src/features/editor/extensions.ts
git commit -m "feat(n): parse pasted Markdown into real nodes"
```

---

### Task 4: The round-trip invariant

One assertion that covers every construct at once, and the only cheap check that can catch a slice-depth or sanitisation mistake across the whole corpus rather than the three shapes Task 3 pins.

**Files:**

- Modify: `src/features/editor/markdownPaste.test.ts`

**Interfaces:**

- Consumes: `normalizeMarkdown(markdown: string): string` from `./markdown`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add `import { normalizeMarkdown } from './markdown';` to the file's imports, then append inside the `describe('MarkdownPaste', ...)` block:

```ts
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
  ])('pasting %s into an empty note matches opening a note that contains it', async (
    _label,
    markdown,
  ) => {
    const handleRef = await mounted();

    paste({ plain: markdown });

    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).toBe(normalizeMarkdown(markdown));
    });
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/editor/markdownPaste.test.ts -t 'matches opening a note'`

**Two outcomes, and they mean different things.**

- **PASS on all ten:** `replaceSelection` already replaces the empty paragraph an empty note starts with. Nothing to do; go to Step 4.
- **FAIL with a leading blank line** (expected `## Weekly report`, received `\n\n## Weekly report` or similar): `replaceSelection` inserted the blocks *after* the empty paragraph instead of replacing it. This is a real defect, not a test artefact — a user pasting into a fresh note would get that blank block. Fix it in Step 3.

This step is deliberately written as a branch rather than a prediction. Which way ProseMirror's slice fitting resolves here was **not** measured while planning, and guessing it in a plan is how sub-project H's plans produced ten defects.

- [ ] **Step 3: (Only if Step 2 failed) Replace the empty block rather than the selection**

In `src/features/editor/MarkdownPaste.ts`, replace the single `view.dispatch(...)` line with:

```ts
            const slice = sliceFor(doc);
            const { tr, selection } = view.state;
            const { $from } = selection;

            // An empty note is ONE empty paragraph, and `replaceSelection`
            // inserts a block slice after it rather than into it — so a paste
            // into a fresh note would keep a blank block above it forever.
            // Replacing the parent node covers that without affecting a paste
            // into real content, where the parent is never empty.
            const intoEmptyBlock =
              slice.openStart === 0 && selection.empty && $from.parent.content.size === 0;

            if (intoEmptyBlock) {
              tr.replaceWith($from.before(), $from.after(), slice.content);
            } else {
              tr.replaceSelection(slice);
            }

            view.dispatch(tr.scrollIntoView());
            return true;
```

Run: `npx vitest run src/features/editor/markdownPaste.test.ts`
Expected: PASS, 16 tests. The inline-paragraph test from Task 3 must still pass — `intoEmptyBlock` requires `openStart === 0`, so the single-paragraph path never takes this branch.

- [ ] **Step 4: Prove the invariant can fail**

Temporarily change `sliceFor` to always return `new Slice(doc.content, 1, 1)`.

Run: `npx vitest run src/features/editor/markdownPaste.test.ts -t 'matches opening a note'`
Expected: FAIL on the multi-block cases — the table, the fenced block and `several blocks` — because an open-depth-1 slice flattens them into the surrounding paragraph. Restore and confirm PASS.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor/MarkdownPaste.ts src/features/editor/markdownPaste.test.ts
git commit -m "test(n): pin the paste round trip against normalizeMarkdown"
```

---

### Task 5: One e2e test — the two-flavour clipboard

jsdom's clipboard is hand-built, so decision 2 — the choice between `text/html` and `text/plain`, and the one the actual bug report came through — cannot be exercised at the unit layer. Task 3 Step 6 measured that: deleting the flavour gate changed no unit result. This is the test that closes it.

**Files:**

- Create: `e2e/pasteMarkdown.spec.ts`

**Interfaces:**

- Consumes: `seedDatabase` from `./fixtures/seed.ts`.
- Produces: nothing.

- [ ] **Step 1: Kill any stale preview server**

```bash
lsof -ti:4173 | xargs -r kill -9
```

Non-negotiable and not paranoia: `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, so a leftover server means the suite silently tests an old build. M9a lost a fault injection to exactly this — the injection "passed" because the build never re-ran.

- [ ] **Step 2: Write the failing test**

Create `e2e/pasteMarkdown.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A paste carrying real clipboard flavours.
 *
 * The ONLY place in the suite where a genuine two-flavour clipboard exists:
 * jsdom has no `DataTransfer` and no `ClipboardEvent` that accepts one, so the
 * unit tests hand-build a payload and cannot prove which flavour the handler
 * chose. A real browser can.
 */
async function paste(page: Page, flavours: { plain: string; html?: string }): Promise<void> {
  await page.evaluate((payload) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', payload.plain);
    if (payload.html !== undefined) transfer.setData('text/html', payload.html);
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, flavours);
}

async function newNote(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
}

test.describe('pasting Markdown', () => {
  test('a Markdown-shaped plain flavour beats the HTML flavour', async ({ page }) => {
    await newNote(page);

    // The reported case: a rich source offers both, and its plain flavour is
    // Markdown. Its HTML flavour carries the &nbsp; and the entity noise that
    // made the original paste unusable.
    await paste(page, {
      plain: '## Weekly report\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
      html: '<p>##&nbsp;Weekly report</p><p>| a | b |</p>',
    });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.getByRole('heading', { level: 2 })).toHaveText('Weekly report');
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('table td')).toHaveCount(2);
    // The `&nbsp;` from the HTML flavour must be nowhere in the note.
    await expect(editor).not.toContainText('nbsp');
  });

  test('a prose plain flavour leaves the HTML flavour to ProseMirror, keeping the link', async ({
    page,
  }) => {
    await newNote(page);

    // Copying a paragraph off a web page. The plain flavour carries no
    // structure, so parsing it would THROW AWAY the link the HTML flavour
    // has. This is the regression decision 2 exists to prevent.
    await paste(page, {
      plain: 'Read the announcement for details.',
      html: '<p>Read <a href="https://example.com">the announcement</a> for details.</p>',
    });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.getByRole('link', { name: 'the announcement' })).toBeVisible();
  });

  test('a plain-only clipboard is always parsed, with no HTML flavour to weigh', async ({
    page,
  }) => {
    await newNote(page);

    // No `text/html` at all — a terminal, a plain editor, a .md file. Decision
    // 1: parsed unconditionally, no detector consulted.
    await paste(page, { plain: '- one\n- two\n- three' });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.locator('ul li')).toHaveCount(3);
  });

  test('entities the Markdown parser leaves literal are decoded', async ({ page }) => {
    await newNote(page);

    await paste(page, { plain: '## Caf&eacute; &mdash; 2026&nbsp;report' });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    const heading = editor.getByRole('heading', { level: 2 });
    await expect(heading).toContainText('Café');
    await expect(heading).toContainText('—');
    await expect(heading).not.toContainText('&');
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx playwright test e2e/pasteMarkdown.spec.ts`
Expected: PASS, 4 tests.

If `a prose plain flavour leaves the HTML flavour to ProseMirror` fails, `looksLikeMarkdown` is matching something in that prose — read which signal, and fix the detector in `pastedMarkdown.ts` with a new negative case added to `pastedMarkdown.test.ts`.

- [ ] **Step 4: Prove the flavour gate is load-bearing HERE, since it could not be at the unit layer**

Temporarily delete the two `html` lines from `handlePaste` in `MarkdownPaste.ts`, then rebuild and rerun:

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/pasteMarkdown.spec.ts
```

Expected: FAIL on `a prose plain flavour leaves the HTML flavour to ProseMirror` — the link is gone, because the prose flavour was parsed as Markdown and Markdown has no link there. Restore the lines, kill 4173 again, and confirm PASS.

This injection is the whole reason this task exists. Task 3 Step 6 proved the unit layer cannot see this.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add e2e/pasteMarkdown.spec.ts
git commit -m "test(n): prove the flavour choice in a real two-flavour clipboard"
```

---

### Task 6: Documentation

Four documents, each wrong in a specific way once N ships. This is not a tidy-up task: `CLAUDE.md`'s paste bullet becomes actively misleading, and the rulings file is the only record of *why* the design is shaped this way.

**Files:**

- Modify: `docs/rulings/markdown-and-schema.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/NEXT.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Extend the rulings file's trigger line**

In `docs/rulings/markdown-and-schema.md`, the `**Trigger:**` paragraph lists the files whose edit requires reading the file first. Add `MarkdownPaste.ts` (`markdownPasteKey`, `sliceFor`) and `pastedMarkdown.ts` (`looksLikeMarkdown`, `decodeEntities`, `PARSER_HANDLED`, `SIGNALS`) to it, in the same style as the neighbouring entries.

`CLAUDE.md`'s rulings index abridges this same trigger. Add the two filenames to that table row too, so the index and the file stay in step — the file's own header note says they must.

- [ ] **Step 2: Add the four rulings**

Append to `docs/rulings/markdown-and-schema.md`:

```markdown
- **Every `text/plain` paste is parsed as Markdown, with no heuristic gate.**
  The app is Markdown — notes load through `parseMarkdown` and save by
  serializing back — so a paste of Markdown becomes the structure it
  describes. A conservative trigger was considered and rejected because the
  boundary is invisible to the user: they cannot tell why one paste became a
  table and another stayed literal, and a rule nobody can predict is worse
  than one that is occasionally wrong. Measured, not assumed: a lone
  `under_score` does not become emphasis and the serializer escapes it
  defensively, so the prose-mangling risk that argued for the heuristic is
  smaller than it reads. `⌘Z` reverses a paste in one step; no
  "paste as plain text" command ships, deliberately.

- **`looksLikeMarkdown` gates the `text/html`-versus-`text/plain` choice and
  NOTHING else.** Widening it to gate the plain-text path would reinstate the
  rejected heuristic above. Where it is used, both branches are structured
  readings of the same content, so a wrong answer costs formatting fidelity;
  on the plain-text path it would be choosing between structure and literal
  characters, where a wrong answer mangles a document. Emphasis (`**bold**`)
  is deliberately not a signal, and `#tag` must not read as a heading — this
  app's own tag syntax is a hash with no space.

- **`decodeEntities` skips exactly `&amp;` `&lt;` `&gt;` `&quot;`, and the set
  is matched case-sensitively.** Those four are what `parseMarkdown` decodes
  itself; decoding them again is a double-decode, and `&amp;amp;` must reach
  the parser intact to become the text `&amp;` rather than `&`. Skipping them
  also preserves `&lt;div&gt;` reaching the parser as an entity pair, which it
  decodes and then claims as a raw-HTML node. Case-sensitively because `&AMP;`
  is a legacy alias the parser does NOT decode, so it must fall through.
  Everything else — `&nbsp;`, `&mdash;`, `&rsquo;`, numeric references —
  survives the parser as literal text **and gains an `&amp;` on the way back
  out**, so a note carrying one is permanently wrong. The decode happens on
  the PASTE path only: a paste is an import, typing is authoring. Fixing it in
  `markdown.ts` would repair typed notes too but edits the one component whose
  failure corrupts notes silently.

- **`MarkdownPaste` uses `handlePaste`; `ImagePaste` uses
  `handleDOMEvents.paste`. That split is load-bearing, not incidental.**
  ProseMirror consults `handleDOMEvents` before `handlePaste`, so an image
  paste is claimed and `preventDefault`ed before the Markdown handler is
  reached — no duplicated file-sniffing, and no ordering dependency between
  the two entries in `buildEditorExtensions`. Verified by injection
  (`markdownPaste.test.ts`'s "leaves an image paste to ImagePaste"), not
  inferred from ProseMirror's documentation. Moving either handler to the
  other hook reintroduces the contention.
```

- [ ] **Step 3: Correct `CLAUDE.md`'s paste bullet**

The bullet beginning **"Typing Markdown into the editor does not parse it as Markdown"** is now wrong by half: pasting parses, typing still does not. Its testing rule is unchanged and must survive the edit — a test about how a construct parses must still SEED the note, never type it. Rewrite it as:

```markdown
- **Typing Markdown into the editor does not parse it as Markdown; PASTING it
  does.** There are no input rules for images, so typing `![x](url)` puts
  literal characters in a text node — and serializing a text node ESCAPES
  them, so the note round-trips to `!\[x\](url)`. Any test about how a
  construct parses must SEED the note (or reload), never type it; and any code
  inserting Markdown must insert a node rather than text, which is why
  `ImagePaste` does. **A paste is different since N**: `MarkdownPaste`'s
  `handlePaste` runs `text/plain` through `parseMarkdown`, so pasted Markdown
  becomes real nodes. Do not read "typing does not parse" as "the editor
  cannot parse" — the asymmetry between the two paths is deliberate and
  documented in `docs/rulings/markdown-and-schema.md`.
```

- [ ] **Step 4: Add the status row**

In `CLAUDE.md`'s status table, after the `M publish` row:

```markdown
| N paste Markdown as Markdown                                      | complete |
```

Then update the test counts in the paragraph below the table to the real numbers from Task 7's full run. Do not guess them — fill them in after Step 2 of that task.

- [ ] **Step 5: Update `NEXT.md`**

Three edits:

1. In the "What is actually left" table, change N's row from `not started — reported from real use 2026-09-01, see below` to `SHIPPED 2026-09-02 — see the spec`.
2. Retitle the `### N.` section to `### N. Paste Markdown as Markdown — SHIPPED 2026-09-02`, and replace the "shape of the fix" paragraph with what was actually decided and what was measured — the four decisions, and the finding that the literal `&gt;` was the same defect rather than a second one. `NEXT.md` is the authority on WHY; the spec carries the detail, so link to it rather than restating it.
3. Add the two residue items to the "What is actually left" table:

```markdown
| **Dropping** Markdown text into a note | not started — N covered pasting only; `ImagePaste` handles `drop` for images, text dropped in keeps the literal behaviour |
| `&amp;nbsp;` round-trip corruption in `markdown.ts` | not started — found while specing N. Named/numeric entities survive `parseMarkdown` as literal text and gain an `&amp;` on serialize, so a TYPED or already-stored `&nbsp;` is permanently wrong. N fixed the paste path only. Needs `CANONICAL` + `NON_CANONICAL` entries. |
```

- [ ] **Step 6: Format and commit**

```bash
npm run format
git add CLAUDE.md docs/rulings/markdown-and-schema.md docs/superpowers/NEXT.md
git commit -m "docs(n): rule the paste path, correct the typing-vs-pasting bullet"
```

---

### Task 7: The full gate

The first and only place the expensive suites run. Per `CLAUDE.md`, a full unit run is ~80 CPU-seconds on a machine that also hosts the API service, so it belongs at a named boundary rather than per task.

**Files:** none — verification only.

- [ ] **Step 1: Kill any stale preview server**

```bash
lsof -ti:4173 | xargs -r kill -9
```

- [ ] **Step 2: Run all six gates**

```bash
npm run typecheck && npm run lint && npm run format && npm run build
npm test -- --run --maxWorkers=4
npm run test:e2e
```

Expected: all green. Record the real unit and e2e test counts — Task 6 Step 4 needs them.

`--maxWorkers=4` because six Vitest workers plus another session's six pins every core on this machine.

- [ ] **Step 3: Check the bundle guard specifically**

The global constraint says no new dependency, and this is where that is proved rather than asserted:

```bash
npx vitest run scripts/bundleSize.test.ts
```

Expected: PASS. N adds no import outside `src/features/editor/`, so the eager chunk should move by well under the 1,884 B of headroom. If it fails, the cause is an accidental import — not a ceiling that needs raising.

- [ ] **Step 4: Read `uptime` before believing any failure**

```bash
uptime
```

Several e2e tests fail under load in ways that look exactly like regressions — `smoke.spec.ts`'s pane-resize persistence, `appearance.spec.ts`'s pane elevation, three different assertions in `graph.spec.ts`. `vitest run` can even exit 1 with every assertion passing. If load is well above the core count, re-run once the machine is quiet before concluding the branch broke anything.

If a failure is real, compare against `main`: three runs each side, per `CLAUDE.md`'s rule that green-green-red across a merge is not a controlled comparison.

- [ ] **Step 5: Verify in the real app, not only in tests**

No gate in this repo can see "renders wrong", and `useSession`'s StrictMode bug passed all six gates and was found only by running the app.

```bash
npm run dev
```

Then, by hand: create a note, copy a Markdown table and a heading from a real source, paste, and confirm the structure appears. Paste a paragraph with a link copied from a web page and confirm the link survives. Paste an image and confirm it still becomes an image.

- [ ] **Step 6: Commit any fixes, then finish the branch**

```bash
git add -A
git commit -m "fix(n): <what the gate found>"
```

Then invoke `superpowers:finishing-a-development-branch`. Note from `CLAUDE.md`: `gh pr create` fails here with `must be a collaborator` because `gh`'s token is the work account, while `git push` uses the SSH host alias and works. A PR must be opened in the browser at `https://github.com/valorjj/bear-web/compare/main...<branch>`, or the branch merged from the CLI.

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
| --- | --- |
| Decision 1, always parse `text/plain` | 3 (handler), 5 (plain-only e2e) |
| Decision 2, plain wins when Markdown-shaped | 1 (detector), 3 (gate), 5 (the only real proof) |
| Decision 3, entities on the paste path | 2 (function), 3 (wiring), 5 (e2e) |
| Decision 4, no escape hatch | nothing to build; asserted by the no-i18n-keys global constraint |
| `handlePaste` vs `handleDOMEvents` ordering | 3 Steps 1/2/5, verified by injection |
| Slice open depth | 3 (`sliceFor`), 4 Step 4 (injection) |
| `pastedMarkdown.ts` as a pure module | 1, 2 |
| The round-trip invariant | 4 |
| Out-of-scope residue named in `NEXT.md` | 6 Step 5 |
| Doc updates (`CLAUDE.md`, ruling, `NEXT.md`) | 6 |
| Bundle ceiling | Global constraint, proved in 7 Step 3 |

**Placeholders:** none. Task 4 Step 2 is a documented branch on a measured outcome, not a TBD — both arms carry the code they need, and the plan says outright that the outcome was not measured while planning.

**Type consistency:** `looksLikeMarkdown(text: string): boolean` and `decodeEntities(text: string): string` are declared in Tasks 1-2 and consumed with those exact names and types in Task 3. `parseMarkdown` and `normalizeMarkdown` match `src/features/editor/markdown.ts`. `RichEditorHandle` is `{ getMarkdown, editor }` (`RichEditor.tsx:40-43`) and the plan uses only those two — checked against the file, not remembered. An earlier draft of Task 3 called a `focus()` that does not exist, and an earlier File Structure listed an `index.ts` edit that has nothing to do; both were corrected against the real source before this plan was committed, which is the same class of error a plan written from memory produced in Task 10 of sub-project H.
