# V — Footnotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `[^1]` renders as a superscript number, `[^1]: text` renders in a 각주
section, clicking navigates both ways, and a toolbar control inserts the pair.

**Architecture:** Two real nodes (`footnoteRef` inline atom,
`footnoteDefinition` block) with their own marked tokenizers, exactly as
`Highlight` and `RawBlock` already register theirs. Numbers are never stored:
one pure `footnoteNumbers(doc)` is called by the editor's decorations AND by
`renderNoteBody`, which already builds a real document before serializing.
Everything else — the 각주 header, the collapse, the `↩`, the numbers — is
decoration, so nothing reaches the user's Markdown.

**Tech Stack:** TypeScript, Tiptap v3 / ProseMirror, marked (via
`@tiptap/markdown`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-v-footnotes-design.md`

## Global Constraints

- **Nothing derived is stored in the document.** Not the number, not the 각주
  header, not the `↩`. A number in an attribute goes stale the moment a marker
  is inserted above it, and would be serialized into the user's file.
- **`footnoteNumbers` is the only place the numbering rule exists.** The editor
  and the export path both call it. A second implementation is this project's
  signature defect — U shipped two heading readers and had to collapse them.
- **Round-trip is the guarantee.** Both forms go into `CANONICAL` in
  `src/features/editor/markdown.test.ts`. That file's own docblock is binding:
  the fixtures are the REVIEWED, INTENDED output, so a serializer disagreement
  is a finding to report, never an expectation to edit.
- **No user-facing string is hardcoded in a component or an extension.**
  Everything through `useT`, threaded into extensions as options the way
  `linkActivateHint` and `linkEditLabel` are; keys go in `src/i18n/en.ts` and
  `ko.ts` (`ko.ts` is `Record<TranslationKey, string>`, so a missing
  translation is a compile error — add it, never weaken the annotation).
- **Every colour from a CSS custom property.** Literal hex or `rgb()` outside
  `src/styles/tokens.css` is a defect.
- **Prefix any new extension option with its extension's name.**
  `buildEditorExtensions` spreads every extension's options into ONE flat
  object and a bare name collides silently — `TableHandles`' `onOpenMenu`
  already did.
- **Read the ruling before the diff:** `docs/rulings/markdown-and-schema.md`
  (Tasks 1, 7), `docs/rulings/export.md` (Task 4),
  `docs/rulings/design-tokens-and-layout.md` (Tasks 5, 8),
  `docs/rulings/accessibility.md` (Tasks 6, 7),
  `docs/rulings/testing-and-tooling.md` (Tasks 3, 9).
- **Gates before every commit:** `npm run typecheck`, `npm run lint`,
  `npm run format`, and the scoped test file. The full suites run at the Task 9
  boundary — see CLAUDE.md's budget section.
- **Before any e2e run:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview
  server on 4173 is silently reused and the suite then tests a stale build.

---

### Task 1: The two nodes and their Markdown

**Files:**

- Create: `src/features/editor/Footnote.ts`
- Create: `src/features/editor/footnote.test.ts`
- Modify: `src/features/editor/extensions.ts` (register both)
- Modify: `src/features/editor/markdown.test.ts` (`CANONICAL` entries)
- Modify: `src/styles/editor.css` (minimal resting styles)

**Interfaces:**

- Consumes: `MarkdownToken`, `MarkdownParseHelpers`, `MarkdownRendererHelpers`
  from `@tiptap/core` — the same imports `Callout.ts` uses.
- Produces: node types `footnoteRef` (inline atom, attr `label`) and
  `footnoteDefinition` (block, attr `label`, `content: inline*`). Tasks 2-8 all
  address nodes by those names and that attribute.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/footnote.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown';

describe('footnote markdown', () => {
  it('parses a marker into a footnoteRef node', () => {
    const doc = parseMarkdown('Alpha[^why] beta.');
    const paragraph = doc.content?.[0];
    const types = (paragraph?.content ?? []).map((child) => child.type);

    expect(types).toContain('footnoteRef');
  });

  it('keeps the label as written', () => {
    const doc = parseMarkdown('Alpha[^why] beta.');
    const ref = (doc.content?.[0]?.content ?? []).find((c) => c.type === 'footnoteRef');

    expect(ref?.attrs?.label).toBe('why');
  });

  it('parses a definition into a footnoteDefinition node', () => {
    const doc = parseMarkdown('Alpha[^1]\n\n[^1]: Because.');
    const last = doc.content?.[doc.content.length - 1];

    expect(last?.type).toBe('footnoteDefinition');
    expect(last?.attrs?.label).toBe('1');
  });

  it('keeps inline marks inside a definition', () => {
    const doc = parseMarkdown('[^1]: Because it is **formalised**.');
    const definition = doc.content?.[0];
    const marks = (definition?.content ?? []).flatMap((c) => (c.marks ?? []).map((m) => m.type));

    expect(marks).toContain('bold');
  });

  // The whole guarantee. A construct that does not round-trip corrupts notes
  // silently, which is why `markdown.test.ts` drives the manager standalone.
  it.each([
    'Alpha[^why] and beta[^when].',
    '[^1]: Because it is formalised.',
    'Alpha[^1] beta.\n\n[^1]: Because.',
    'A label with-punctuation[^see-also].',
  ])('round-trips %s', (markdown) => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });

  /**
   * The narrow grammar, and each of these is a case a permissive one gets
   * wrong. A note ABOUT markdown will contain these strings.
   */
  it.each([
    ['a bare caret', 'Alpha [^ ] beta.'],
    ['an unclosed marker', 'Alpha [^why beta.'],
    ['an empty label', 'Alpha [^] beta.'],
    ['a caret inside the label', 'Alpha [^a^b] beta.'],
  ])('leaves %s as plain text', (_name, markdown) => {
    const doc = parseMarkdown(markdown);
    const types = (doc.content?.[0]?.content ?? []).map((child) => child.type);

    expect(types).not.toContain('footnoteRef');
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it('does not see a marker inside code', () => {
    const doc = parseMarkdown('Alpha `[^1]` beta.');
    const types = (doc.content?.[0]?.content ?? []).map((child) => child.type);

    expect(types).not.toContain('footnoteRef');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/editor/footnote.test.ts`
Expected: FAIL — no `footnoteRef` node exists, so the marker stays text.

- [ ] **Step 3: Write the nodes**

Create `src/features/editor/Footnote.ts`:

```ts
import { Node } from '@tiptap/core';
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core';

/**
 * A footnote label: one or more characters that are not `]`, whitespace or
 * `^`.
 *
 * DELIBERATELY narrower than CommonMark, which allows almost anything between
 * the brackets. A permissive label lets `[^` swallow prose when the closing
 * bracket never comes, and a note ABOUT markdown is exactly where that
 * happens. The tag grammar carries the same scar — see
 * `docs/rulings/tag-grammar.md`.
 */
const LABEL = String.raw`([^\]\s^]+)`;
const REF = new RegExp(`^\\[\\^${LABEL}\\]`);
const DEFINITION = new RegExp(`^\\[\\^${LABEL}\\]:[ \\t]*([^\\n]*)(?:\\n|$)`);

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote-ref') ?? '',
        renderHTML: (attributes) => ({ 'data-footnote-ref': attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-ref]' }];
  },

  /**
   * `<sup>` with NO text content: the number is a decoration in the editor and
   * is written in by `renderNoteBody` for an export. Putting it here would
   * mean storing derived data in the document.
   */
  renderHTML({ HTMLAttributes }) {
    return ['sup', { ...HTMLAttributes, class: 'bear-footnote-ref' }];
  },

  markdownTokenName: 'footnoteRef',

  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline',
    start: (src: string) => src.indexOf('[^'),
    tokenize: (src: string) => {
      const match = REF.exec(src);
      if (!match) return undefined;
      return { type: 'footnoteRef', raw: match[0], label: match[1] };
    },
  },

  parseMarkdown: (token: MarkdownToken) => ({
    type: 'footnoteRef',
    attrs: { label: (token as { label?: string }).label ?? '' },
  }),

  renderMarkdown: (node: JSONContent) => `[^${String(node.attrs?.label ?? '')}]`,
});

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote-def') ?? '',
        renderHTML: (attributes) => ({ 'data-footnote-def': attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-footnote-def]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', { ...HTMLAttributes, class: 'bear-footnote-def' }, 0];
  },

  markdownTokenName: 'footnoteDefinition',

  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    start: (src: string) => src.indexOf('[^'),
    tokenize: (src: string, _tokens: unknown, lexer: { inlineTokens: (s: string) => unknown[] }) => {
      const match = DEFINITION.exec(src);
      if (!match) return undefined;
      const text = match[2] ?? '';
      return {
        type: 'footnoteDefinition',
        raw: match[0],
        label: match[1],
        text,
        tokens: lexer.inlineTokens(text),
      };
    },
  },

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.createNode(
      'footnoteDefinition',
      { label: (token as { label?: string }).label ?? '' },
      helpers.parseChildren(token.tokens ?? []),
    ),

  renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) =>
    `[^${String(node.attrs?.label ?? '')}]: ${helpers.renderChildren(node.content ?? [])}`,
});
```

- [ ] **Step 4: Register them**

In `src/features/editor/extensions.ts`, import both and add them to
`buildSupportedExtensions`' array beside `Callout`. They take no options, so no
`.configure` and no addition to the options union — an extension with no
options cannot collide in the flat merge.

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run src/features/editor/footnote.test.ts`
Expected: PASS.

> If the block tokenizer never fires, check ORDER: marked runs block
> tokenizers before inline ones, so `[^1]: text` on its own line must be
> consumed by `footnoteDefinition` before `footnoteRef` sees the `[^1]`. If it
> is not, the definition parses as a paragraph containing a ref — which is a
> real finding, not a test to relax.

- [ ] **Step 6: Add the round-trip fixtures**

In `src/features/editor/markdown.test.ts`, add to `CANONICAL`:

```ts
  // V. Both halves, and a word label — the number is positional, so a label
  // that is not a digit must survive a round trip untouched.
  { name: 'footnote marker', markdown: 'Alpha[^1] beta.' },
  { name: 'footnote definition', markdown: '[^1]: Because.' },
  { name: 'footnote pair', markdown: 'Alpha[^why] beta.\n\n[^why]: Because.' },
```

- [ ] **Step 7: Minimal resting styles**

In `src/styles/editor.css`, enough that the nodes are visible and legible —
the 각주 section chrome is Task 5, not this task.

```css
/* The marker. `<sup>` carries no text of its own: the number arrives as a
 * decoration in the editor and is written in by `renderNoteBody` for an
 * export — see `footnoteNumbers`. */
.ProseMirror .bear-footnote-ref {
  color: var(--bear-accent);
  cursor: pointer;
  font-size: 0.7em;
  vertical-align: super;
  line-height: 0;
}

.ProseMirror .bear-footnote-def {
  display: block;
  color: var(--bear-muted);
  font-size: 0.92em;
}
```

- [ ] **Step 8: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/features/editor/footnote.test.ts src/features/editor/markdown.test.ts
git add src/features/editor src/styles/editor.css
git commit -m "feat(editor): footnote markers and definitions as real nodes"
```

---

### Task 2: Measure the bundle, before building the rest

**Read first:** `docs/rulings/testing-and-tooling.md`'s eager-JS ceiling bullet.

This is a checkpoint, not a feature. The spec commits to measuring at roughly
half the cost so the answer arrives while the branch is small.

- [ ] **Step 1: Measure**

```bash
npm run build
npx vitest run scripts/bundleSize.test.ts
```

- [ ] **Step 2: Record the number**

Note the eager total. Headroom at the start of V is **2,985 B** under a
`CEILING_BYTES` of 361,000 (read the constant, never a figure quoted in prose).

- [ ] **Step 3: Decide, and do not decide alone**

If Task 1 has consumed most of the headroom, STOP and report to the user with
both numbers before building Tasks 3-8. The ruling's options, in order:
move code behind a `React.lazy` boundary; move work to the server; cut scope.
**Raising `CEILING_BYTES` is the user's explicit decision, not a step in this
plan.**

If there is comfortable room, say the number in the task report and continue.

---

### Task 3: `footnoteNumbers`

**Files:**

- Create: `src/features/editor/footnoteNumbers.ts`
- Create: `src/features/editor/footnoteNumbers.test.ts`

**Interfaces:**

- Produces: `footnoteNumbers(doc: ProseMirrorNode): Map<string, number>`.
  Tasks 4 and 5 both call it; nothing else computes numbering.

- [ ] **Step 1: Write the failing test**

```ts
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { footnoteNumbers } from './footnoteNumbers';
import { parseMarkdownDoc } from './markdown';

describe('footnoteNumbers', () => {
  const numbers = (markdown: string) => footnoteNumbers(parseMarkdownDoc(markdown));

  it('numbers by order of first reference, not by label', () => {
    const result = numbers('Alpha[^why] and beta[^when].\n\n[^when]: b\n\n[^why]: a');

    expect(result.get('why')).toBe(1);
    expect(result.get('when')).toBe(2);
  });

  it('gives a label referenced twice one number', () => {
    const result = numbers('A[^x] B[^x] C[^y].');

    expect(result.get('x')).toBe(1);
    expect(result.get('y')).toBe(2);
    expect(result.size).toBe(2);
  });

  it('gives an unreferenced definition no number', () => {
    const result = numbers('A[^x].\n\n[^x]: one\n\n[^orphan]: two');

    expect(result.has('orphan')).toBe(false);
  });

  it('numbers a marker whose definition is missing', () => {
    // Fail open: a marker written before its definition is the ordinary
    // mid-writing state, not an error.
    expect(numbers('A[^ghost].').get('ghost')).toBe(1);
  });

  it('renumbers when a reference is inserted in the middle', () => {
    const before = numbers('A[^one] C[^three].');
    const after = numbers('A[^one] B[^two] C[^three].');

    expect(before.get('three')).toBe(2);
    expect(after.get('three')).toBe(3);
  });
});
```

> `parseMarkdownDoc` is the helper U added to `markdown.ts`; it returns a real
> `ProseMirrorNode` so no `Editor` has to be constructed. Confirm the export
> exists before writing this file.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/editor/footnoteNumbers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Footnote labels mapped to their displayed number, by order of FIRST
 * reference.
 *
 * THE ONLY place the numbering rule exists. The editor paints these as
 * decorations and `renderNoteBody` writes them into exported HTML — two
 * mediums, one rule, nothing to keep in agreement. Decorations never
 * serialize, so an export that derived its own numbering would be a second
 * implementation of exactly the kind sub-project U had to collapse.
 *
 * Definitions are not consulted at all: a marker with no definition still
 * takes a number (a note mid-writing), and a definition nobody references
 * takes none.
 */
export function footnoteNumbers(doc: ProseMirrorNode): Map<string, number> {
  const numbers = new Map<string, number>();

  doc.descendants((node) => {
    if (node.type.name !== 'footnoteRef') return true;
    const label = String(node.attrs.label ?? '');
    if (label !== '' && !numbers.has(label)) numbers.set(label, numbers.size + 1);
    return false;
  });

  return numbers;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/features/editor/footnoteNumbers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor
git commit -m "feat(editor): footnoteNumbers, the one place the numbering rule lives"
```

---

### Task 4: Numbers in the editor, and in every export

**Read first:** `docs/rulings/export.md`.

**Files:**

- Create: `src/features/editor/FootnoteDecorations.ts` (+ its test)
- Modify: `src/features/export/html.ts` (`renderNoteBody`)
- Modify: `src/features/export/html.test.ts`
- Modify: `src/features/editor/extensions.ts`

- [ ] **Step 1: Write the failing export test first**

The export is the half that silently produces nothing if numbering is left to
decorations, so it gets the first test:

```ts
it('writes footnote numbers into the exported HTML', () => {
  const html = renderNoteBody('Alpha[^why] and beta[^when].\n\n[^why]: a\n\n[^when]: b');

  // The NUMBER, not the label: decorations do not serialize, so this is what
  // fails if the editor is the only place numbering happens.
  expect(html).toContain('>1</sup>');
  expect(html).toContain('>2</sup>');
});

it('numbers the definitions to match their markers', () => {
  const html = renderNoteBody('Alpha[^why].\n\n[^why]: a');

  expect(html).toMatch(/data-footnote-def="why"[^>]*>\s*1\./);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/export/html.test.ts -t footnote`
Expected: FAIL — the `<sup>` is empty.

- [ ] **Step 3: Implement the export pass**

In `renderNoteBody`, after the fragment is serialized and before the other
post-processing passes, walk `[data-footnote-ref]` and `[data-footnote-def]`
and write the numbers from `footnoteNumbers(document_)` — the document it
already built on the line above. Model the walk on `highlightCodeBlocks`, which
exists in that file for the identical reason: a view-layer concept with no
serialized form.

An unnumbered definition (nobody references it) keeps its label instead.

- [ ] **Step 4: Implement the editor decorations**

`FootnoteDecorations.ts`: a plugin whose `decorations` calls `footnoteNumbers`
on `state.doc` and returns a widget before each `footnoteRef` carrying its
number, plus one before each definition. Register in `extensions.ts`.

> Recompute per `decorations()` call rather than caching in plugin state. The
> map is small, the walk is one pass, and a cache keyed on anything but the
> whole document is how a number goes stale after an edit two paragraphs away.

- [ ] **Step 5: Run and watch both pass**

Run: `npx vitest run src/features/export/ src/features/editor/`
Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor src/features/export
git commit -m "feat: footnote numbers in the editor and in every export path"
```

---

### Task 5: The 각주 section

**Read first:** `docs/rulings/design-tokens-and-layout.md`.

**Files:**

- Modify: `src/features/editor/FootnoteDecorations.ts` (+ test)
- Modify: `src/styles/editor.css`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/features/editor/extensions.ts`, `RichEditor.tsx` (thread the label)

- [ ] **Step 1: Write the failing test**

```ts
it('draws one header above the first definition', () => { /* count === 1 */ });
it('draws no header when the note has no definitions', () => { /* count === 0 */ });
it('hides the definitions when collapsed and restores them', () => { /* toggle */ });
it('puts no header text into the document', () => {
  // The header is chrome. Baking a UI-language string into note text would
  // make the note depend on the language selected at the last save —
  // `Callout.ts` argues this at its own placeholder.
  expect(serializeMarkdown(editor.getJSON())).not.toContain('각주');
});
```

- [ ] **Step 2-4: Implement**

A widget decoration above the first `footnoteDefinition` carrying the header
text (injected as the `footnoteSectionLabel` option — prefixed, per the flat
merge rule) and a disclosure button. Collapse state lives in plugin state,
defaults open, is NOT persisted (see the spec), and hides the definitions with
the same `display: none` mechanism `.bear-fold-hidden` uses.

Add `editor.footnotes.section` to both locales.

- [ ] **Step 5: Look at it**

Screenshot the section open and collapsed, in a light and a dark theme, with
the throwaway-spec recipe in Task 9. No test can judge whether it reads as a
section.

- [ ] **Step 6: Gates and commit**

---

### Task 6: Navigation

**Files:**

- Modify: `src/features/editor/HeadingReveal.ts` (extract `revealAt`)
- Modify: `src/features/editor/FootnoteDecorations.ts`
- Modify: `src/features/editor/RichEditor.tsx`
- Tests for both directions

- [ ] **Step 1: Extract the reusable core**

`HeadingReveal` currently takes a heading's TEXT, finds its position, and
flashes it. Extract "reveal this POSITION" — flash, and let the caller scroll —
keeping `revealHeading`'s text lookup on top of it. **No behaviour change to U:**
its tests must pass untouched, and that is the check that the extraction was an
extraction.

- [ ] **Step 2: Marker → definition**

Clicking a `footnoteRef` finds the `footnoteDefinition` with the same label,
reveals it, and scrolls. Unfolding is not needed — the 각주 collapse is this
plugin's own state, so expand it directly rather than through `keysRevealing`.

- [ ] **Step 3: Definition → marker**

A `↩` widget on each definition returns to that label's FIRST marker. A widget,
not a character: anything in the document reaches the Markdown and every
export.

- [ ] **Step 4: Tests, then commit**

Both directions, plus: a marker whose definition is missing does nothing and
does not throw.

---

### Task 7: `insertFootnote`, the toolbar control and the shortcut

**Read first:** `docs/rulings/markdown-and-schema.md` (a new keyboard binding),
`docs/rulings/accessibility.md`.

**Files:**

- Modify: `src/features/editor/Footnote.ts` (the command)
- Modify: `src/features/editor/BottomToolbar.tsx`
- Modify: `src/i18n/en.ts`, `ko.ts`
- Tests

- [ ] **Step 1: Write the failing test**

```ts
it('inserts a marker and its definition in ONE transaction', () => {
  // One undo restores both halves. A test that checks only the marker passes
  // against two transactions, and the writer then has to undo twice.
  editor.commands.insertFootnote();
  editor.commands.undo();

  expect(serializeMarkdown(editor.getJSON())).toBe(before);
});

it('picks the next free numeric label', () => { /* 1, then 2 */ });
it('skips a numeric label already in use', () => { /* [^1] exists → 2 */ });
it('puts the caret in the new definition', () => { /* selection inside it */ });
it('appends after the last existing definition', () => { /* order */ });
```

- [ ] **Step 2-4: Implement**

One chained command on one transaction. Label = `max(numeric labels) + 1`,
starting at 1. Insert the definition after the last `footnoteDefinition`, or at
the end of the document when there is none.

Add the toolbar action beside `callout` in `BottomToolbar.tsx`'s action list
(its shape is `{ key, label, glyph, run, active }`), with a lucide glyph added
verbatim to `ICON_NODES` plus a row in `Icon.test.tsx`'s `it.each` if it is not
already registered.

- [ ] **Step 5: Gates and commit**

---

### Task 8: Orphans, and the styling pass

- [ ] A marker with no definition renders muted, as an unresolved `[[link]]`
      does. A definition nobody references keeps its label instead of a number.
      Both get tests and both get a screenshot — they are the states a writer
      is in most of the time while writing.

---

### Task 9: End-to-end, docs, and the full gate

- [ ] **Step 1: `e2e/footnotes.spec.ts`**

Five tests, each asserting a value that changes with the behaviour:

- the toolbar control inserts the pair and the caret lands in the definition —
  **driven through the real control, not by typing the Markdown it produces**
  (U shipped a feature unreachable by its own flow because every test typed the
  input by hand; `docs/rulings/tag-pills.md` records it);
- clicking a marker lands on its definition — `toBeInViewport`, not
  `toBeVisible`;
- the `↩` returns to the marker;
- collapsing the section hides the definition BODIES — assert
  `toBeHidden`/`toBeVisible`, never `toContainText`, which reads `textContent`
  and is true for `display: none` text;
- inserting a footnote above an existing one renumbers the display without
  changing the text.

- [ ] **Step 2: Prove the tests can fail.** Break the numbering (return an
      empty map) and the insert (two transactions); confirm the right tests
      fail; restore. Kill port 4173 before each run.

- [ ] **Step 3: Rulings.** `markdown-and-schema.md` (the two nodes, the narrow
      label grammar, the tokenizer order), `export.md` (numbering is written in
      by `renderNoteBody` because decorations do not serialize),
      `design-tokens-and-layout.md` (the section chrome, the collapse not being
      persisted), `accessibility.md` (the marker's and `↩`'s accessible names).

- [ ] **Step 4: Status docs.** A `V footnotes` row in CLAUDE.md, a section in
      `docs/superpowers/NEXT.md`, and the real test counts from step 5.

- [ ] **Step 5: The full gate**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
npm run build
npm run measure:check
```

- [ ] **Step 6: Commit**

---

## Self-review

**Spec coverage.** Schema → Task 1. Markdown + fixtures → Task 1. Numbering →
Task 3. Editor and export numbering → Task 4. The 각주 section and its collapse
→ Task 5. Navigation and the `↩` → Task 6. Writing control → Task 7. Orphans →
Task 8. The bundle risk the spec promised to measure early → Task 2, placed
immediately after the schema and Markdown layer as the spec commits to. Testing
section → spread across every task plus Task 9. Non-goals need no task:
multi-paragraph definitions are excluded by the tokenizer's `[^\n]*`, and
nothing here touches Dexie.

**Placeholders.** Tasks 5-8 describe test bodies rather than spelling every
line, because each depends on a harness helper whose real name must be read
from the file first; that is called out at each site rather than left as "write
tests". Every pure function — the tokenizers, `footnoteNumbers` — has complete
code.

**Type consistency.** `footnoteRef`/`footnoteDefinition` and the `label`
attribute are used with those names in Tasks 1, 3, 4, 5, 6, 7 and 8.
`footnoteNumbers(doc) → Map<string, number>` is defined in Task 3 and called
with that signature in Task 4. `parseMarkdownDoc` is U's, and Task 3 says to
confirm it before writing against it.
