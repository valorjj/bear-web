# M9b Callout Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five tinted, icon-marked callout blocks written as `> [!warning] Title`, rendered in the editor and in every export — and, first, a fix for the escaping bug that corrupts such a note today.

**Architecture:** A callout is a `blockquote` carrying a `callout` attribute, not a new node — the Markdown says they are the same thing, so every existing blockquote affordance keeps working. Its title is a real `calloutTitle` child node with inline content, so the header is typed into directly. Colour derives from one global hue set exactly as `--bear-hl-*` does, and the icon is a CSS `mask-image` so it needs no JavaScript in either the editor or an exported file.

**Tech Stack:** Tiptap v3 (`@tiptap/starter-kit`, `@tiptap/markdown`), ProseMirror, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-m9b-callout-blocks-design.md`

## Global Constraints

- **Canonical types:** `info` `tip` `success` `warning` `danger` — lowercase, exactly five, nothing else.
- **Written Markdown form is loose:** `> [!warning] Title`, then `>`, then the body. Both spacings are read; only this one is written.
- **Aliases normalize on save.** `note|info|abstract|summary`→`info`; `tip|hint|important`→`tip`; `success|check|done`→`success`; `warning|caution|attention`→`warning`; `danger|error|failure|bug`→`danger`. Matching is case-insensitive.
- **An unrecognised marker is never a colour and never lost** — plain blockquote plus a `rawMarker` attribute that serializes back verbatim.
- **No user-facing string is hardcoded.** Everything through `useT`; `src/i18n/en.ts` defines the key type and `ko.ts` must gain every key or typecheck fails. Never weaken `ko.ts`'s annotation.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` is a defect that `scripts/sourceLint.test.ts` catches.
- **`src/features/editor/` must not import `@/i18n`.** Translated strings arrive as extension options through `buildEditorExtensions`, the way `foldHint` reaches `HeadingFold`.
- **Callouts do not collapse.** B1's "no blockquote folding" stands.
- **All six gates pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`. Scope unit runs to changed files during a task; run the full suite at task boundaries only.
- **Before any e2e run that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`.

---

## File Structure

**Created:**
- `src/features/editor/callouts.ts` — the type roster, alias table, marker regex, and the pure `parseMarker` / `formatMarker` functions. No Tiptap, no React, no i18n: this is the file the round-trip tests drive directly.
- `src/features/editor/callouts.test.ts`
- `src/features/editor/Callout.ts` — the extended `Blockquote` node (attributes, markdown hooks, `renderHTML`) and the `calloutTitle` node.
- `src/features/editor/callout.test.ts`
- `src/features/editor/CalloutMenu.tsx` — the chevron menu. Mirrors `HighlightMenu.tsx`.
- `src/features/editor/CalloutMenu.test.tsx`
- `e2e/callouts.spec.ts`

**Modified:**
- `src/features/editor/extensions.ts` — `blockquote: false`, register `Callout` + `CalloutTitle`.
- `src/features/editor/markdown.ts` — `sanitize` gains the stray-`calloutTitle` repair.
- `src/features/editor/editorState.ts` — expose the active callout type.
- `src/features/editor/BottomToolbar.tsx` — the chevron beside Quote.
- `src/features/editor/RichEditor.tsx` — menu state, placement, i18n options.
- `src/styles/tokens.css` — hues, alpha, fill and edge tokens.
- `src/styles/editor.css` — callout rendering.
- `src/features/export/html.ts` — `EXPORT_TOKEN_NAMES`, `FALLBACKS`, mirrored stylesheet block.
- `src/features/notes/format.ts` — strip the marker, keep the title.
- `src/i18n/en.ts`, `src/i18n/ko.ts`.
- `e2e/contrast.spec.ts`, `e2e/fixtures/corpus.ts`, `e2e/shots.spec.ts`.
- `CLAUDE.md`, `docs/rulings/markdown-and-schema.md`, `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/accessibility.md`.

---

### Task 1: The marker grammar, and the escaping bug

Ships the corruption fix on its own, before any colour exists.

**Files:**
- Create: `src/features/editor/callouts.ts`, `src/features/editor/callouts.test.ts`
- Modify: `src/features/editor/Callout.ts` (create), `src/features/editor/extensions.ts`
- Test: `src/features/editor/callouts.test.ts`, `src/features/editor/markdown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CalloutType = 'info' | 'tip' | 'success' | 'warning' | 'danger'`
  - `const CALLOUT_TYPES: readonly CalloutType[]`
  - `function parseMarker(text: string): { type: CalloutType | null; raw: string; title: string; rest: string } | null` — `null` when the text does not begin with a marker. `type` is `null` for an unrecognised word, and `raw` then carries it verbatim. `title` is the text after the marker up to the first newline; `rest` is everything after that newline (`''` when there is none).
  - `function formatMarker(type: CalloutType | null, raw: string | null): string` — `'[!warning]'`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { CALLOUT_TYPES, formatMarker, parseMarker } from './callouts';

describe('parseMarker', () => {
  it('declines text with no marker', () => {
    expect(parseMarker('just prose')).toBeNull();
  });

  it('reads a type and a title', () => {
    expect(parseMarker('[!warning] Be careful')).toEqual({
      type: 'warning', raw: 'warning', title: 'Be careful', rest: '',
    });
  });

  it('reads the tight form, splitting title from body at the first newline', () => {
    // Obsidian and GitHub both write this; the parser produces ONE paragraph
    // whose text carries a hard newline. Verified against the real pipeline.
    expect(parseMarker('[!warning] Title\nBody.')).toEqual({
      type: 'warning', raw: 'warning', title: 'Title', rest: 'Body.',
    });
  });

  it('accepts an untitled marker', () => {
    expect(parseMarker('[!tip]')).toEqual({ type: 'tip', raw: 'tip', title: '', rest: '' });
  });

  it.each([
    ['note', 'info'], ['INFO', 'info'], ['abstract', 'info'], ['summary', 'info'],
    ['hint', 'tip'], ['Important', 'tip'],
    ['check', 'success'], ['done', 'success'],
    ['caution', 'warning'], ['ATTENTION', 'warning'],
    ['error', 'danger'], ['failure', 'danger'], ['bug', 'danger'],
  ])('normalizes the alias %s to %s', (alias, expected) => {
    expect(parseMarker(`[!${alias}] T`)?.type).toBe(expected);
  });

  it('keeps an unrecognised word verbatim and refuses to guess a type', () => {
    expect(parseMarker('[!사내공지] 제목')).toEqual({
      type: null, raw: '사내공지', title: '제목', rest: '',
    });
  });

  it('declines a marker that is not at the very start', () => {
    expect(parseMarker('see [!warning] here')).toBeNull();
  });
});

describe('formatMarker', () => {
  it('writes the canonical spelling, not the alias it came from', () => {
    expect(formatMarker(parseMarker('[!CAUTION] x')!.type, null)).toBe('[!warning]');
  });

  it('writes an unrecognised word back verbatim', () => {
    expect(formatMarker(null, '사내공지')).toBe('[!사내공지]');
  });

  it('covers every type in the roster', () => {
    for (const type of CALLOUT_TYPES) expect(formatMarker(type, null)).toBe(`[!${type}]`);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/editor/callouts.test.ts`
Expected: FAIL — `Failed to resolve import "./callouts"`.

- [ ] **Step 3: Implement `callouts.ts`**

Pure module. `MARKER = /^\[!([^\]\n]+)\][ \t]?/`. Alias map keyed by lowercased word. Split the remainder at the first `\n`.

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/editor/callouts.test.ts` → PASS.

- [ ] **Step 5: Write the round-trip test that proves the bug**

Add to `src/features/editor/markdown.test.ts`:

```ts
it('does not escape a callout marker, which corrupts every GitHub alert', () => {
  // The bug this milestone opens with. Before the tokenizer claimed the
  // marker this returned '> \\[!NOTE\\]', so merely opening and saving a note
  // carrying an alert rewrote it.
  expect(normalizeMarkdown('> [!NOTE]\n>\n> Plain GFM alert.')).toBe(
    '> [!info]\n>\n> Plain GFM alert.',
  );
});
```

- [ ] **Step 6: Run and verify failure**

Run: `npx vitest run src/features/editor/markdown.test.ts -t "does not escape"` → FAIL showing backslashes.

- [ ] **Step 7: Create `Callout.ts` with the node and its markdown hooks; wire into `extensions.ts`**

`Blockquote.extend({ name: 'blockquote', addAttributes, parseMarkdown, renderMarkdown })`, plus a `CalloutTitle` node (`content: 'inline*'`, `defining: true`, `parseHTML`/`renderHTML` on `div[data-callout-title]`). Register with `StarterKit.configure({ underline: false, codeBlock: false, blockquote: false })` and add both nodes to `buildSupportedExtensions`.

- [ ] **Step 8: Run and verify pass**

Run: `npx vitest run src/features/editor/markdown.test.ts src/features/editor/callouts.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "fix(editor): a callout marker no longer escapes itself into corruption"
```

---

### Task 2: The schema repair, proven by fault injection

**Files:**
- Modify: `src/features/editor/markdown.ts` (`sanitize`)
- Test: `src/features/editor/markdown.test.ts`

**Interfaces:**
- Consumes: `CalloutTitle` from Task 1.
- Produces: nothing new; `parseMarkdown`/`serializeMarkdown` keep their signatures.

- [ ] **Step 1: Write the failing test**

```ts
it('unwraps a calloutTitle that is not a callout’s first child', () => {
  // A node in an invalid position is the "editor silently refuses to be typed
  // into" failure recorded in CLAUDE.md, which shipped for a day. `sanitize`
  // already repairs one such class; this is the second.
  const doc = {
    type: 'doc',
    content: [{ type: 'calloutTitle', content: [{ type: 'text', text: 'stray' }] }],
  };

  expect(serializeMarkdown(doc)).toBe('stray');
});

it('keeps a calloutTitle that IS a callout’s first child', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'blockquote',
        attrs: { callout: 'warning', rawMarker: null },
        content: [
          { type: 'calloutTitle', content: [{ type: 'text', text: 'T' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        ],
      },
    ],
  };

  expect(serializeMarkdown(doc)).toBe('> [!warning] T\n>\n> B');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/editor/markdown.test.ts -t calloutTitle` → FAIL.

- [ ] **Step 3: Implement the repair in `sanitize`**

Walk each node's children; when a child is `calloutTitle` and (the parent is not `blockquote`, or the child is not at index 0, or the parent has no `callout`/`rawMarker`), replace it with `{ type: 'paragraph', content: child.content }`.

- [ ] **Step 4: Run and verify pass** → PASS.

- [ ] **Step 5: Fault-inject to prove the test can fail**

Comment the repair out, re-run, confirm FAIL, restore. Record the observed failure message in the test's comment.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix(editor): sanitize unwraps a stray calloutTitle rather than shipping an unusable document"
```

---

### Task 3: Round-trip fixtures

**Files:**
- Modify: `src/features/editor/roundTrip.test.ts` (or wherever `CANONICAL`/`NON_CANONICAL` live — grep for `CANONICAL`)
- Test: same file

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: nothing.

- [ ] **Step 1: Add fixtures**

`CANONICAL` gains one entry per type in the loose form plus an untitled one and an unrecognised marker. `NON_CANONICAL` gains the tight form and each alias, mapping to its canonical output.

- [ ] **Step 2: Run** → PASS. `npx vitest run src/features/editor/`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(editor): callout fixtures in both round-trip corpora"
```

---

### Task 4: Tokens and the sixteen-theme contrast pass

**Files:**
- Modify: `src/styles/tokens.css`, `e2e/contrast.spec.ts`, `e2e/fixtures/tokens.ts` (if it carries a token list)
- Test: `e2e/contrast.spec.ts`

**Interfaces:**
- Produces: `--bear-cal-hue-{type}`, `--bear-cal-a`, `--bear-cal-fill-{type}`, `--bear-cal-edge-{type}` for each of the five types.

- [ ] **Step 1: Add the contrast rows first, so they fail before the tokens exist**

```ts
// in OVERLAYS — a callout's body is prose on a tinted panel.
{ overlay: 'cal-fill-info', ground: 'bg', fg: 'text', min: 4.5 },
{ overlay: 'cal-fill-tip', ground: 'bg', fg: 'text', min: 4.5 },
{ overlay: 'cal-fill-success', ground: 'bg', fg: 'text', min: 4.5 },
{ overlay: 'cal-fill-warning', ground: 'bg', fg: 'text', min: 4.5 },
{ overlay: 'cal-fill-danger', ground: 'bg', fg: 'text', min: 4.5 },
```

```ts
// in DECORATIVE — the bar and the icon are marks, not text, so 3.0 not 4.5.
{ fg: 'cal-edge-info', grounds: ['bg'], min: 3.0 },
{ fg: 'cal-edge-tip', grounds: ['bg'], min: 3.0 },
{ fg: 'cal-edge-success', grounds: ['bg'], min: 3.0 },
{ fg: 'cal-edge-warning', grounds: ['bg'], min: 3.0 },
{ fg: 'cal-edge-danger', grounds: ['bg'], min: 3.0 },
```

Add all ten names to `READ`.

- [ ] **Step 2: Run and verify failure**

Run: `lsof -ti:4173 | xargs -r kill -9; npx playwright test e2e/contrast.spec.ts`
Expected: FAIL — an undefined token paints as an empty string.

- [ ] **Step 3: Add the derived tokens to `tokens.css`**

One hue per type near `--bear-hl-hue-*`, an alpha keyed on `--bear-dark`, and `color-mix` fills. Follow the existing highlight block exactly.

- [ ] **Step 4: Run, read every failure, add per-theme overrides**

Run the spec again. Expect real failures in `high-contrast`, `gruvbox-*` and `solarized-*`. Override the specific token in the specific theme block; never lower a `min`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(theme): callout fills and edges, contrast-checked across the roster"
```

---

### Task 5: Editor rendering

**Files:**
- Modify: `src/features/editor/Callout.ts` (`renderHTML`), `src/styles/editor.css`
- Test: `src/features/editor/callout.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 4.
- Produces: a `blockquote[data-callout="warning"]` carrying `> div[data-callout-title]`.

- [ ] **Step 1: Write the failing test**

```ts
it('marks the rendered blockquote with its type so CSS can find it', () => {
  const editor = mountEditor('> [!warning] T\n>\n> B');
  const quote = editor.view.dom.querySelector('blockquote');
  expect(quote?.getAttribute('data-callout')).toBe('warning');
  expect(quote?.querySelector('[data-callout-title]')?.textContent).toBe('T');
});

it('leaves a plain blockquote unmarked', () => {
  const editor = mountEditor('> just a quote');
  expect(editor.view.dom.querySelector('blockquote')?.hasAttribute('data-callout')).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: implement `renderHTML`. Step 4: run → PASS.**

- [ ] **Step 5: Add the CSS**

`editor.css`: fill, a 6px left edge, radius `--bear-radius-md`, and `::before` on the title drawing the icon via `mask-image` + `background: currentColor`, one rule per `[data-callout=…]`. The empty-title placeholder uses `[data-callout-title]:empty::after { content: attr(data-placeholder) }`, whose value the node sets from options.

- [ ] **Step 6: Verify by eye in the real app.** No unit test can see "renders wrong": `npm run dev`, make one of each type, check two light and two dark themes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(editor): callouts render as tinted panels with an icon"
```

---

### Task 6: The toolbar chevron, the menu, and the input rule

**Files:**
- Create: `src/features/editor/CalloutMenu.tsx`, `src/features/editor/CalloutMenu.test.tsx`
- Modify: `src/features/editor/BottomToolbar.tsx`, `src/features/editor/RichEditor.tsx`, `src/features/editor/editorState.ts`, `src/features/editor/Callout.ts` (commands + input rule), `src/i18n/en.ts`, `src/i18n/ko.ts`
- Test: `src/features/editor/CalloutMenu.test.tsx`, `src/features/editor/toolbars.test.tsx`

**Interfaces:**
- Consumes: `CalloutType`, `CALLOUT_TYPES`.
- Produces:
  - `editor.commands.setCalloutType(type: CalloutType | null): boolean`
  - `EditorFlags` gains `calloutType: CalloutType | null`
  - `CalloutMenuProps { current: CalloutType | null; onChoose: (t: CalloutType | null) => void; onDismiss: () => void }`

- [ ] **Step 1: i18n keys** — `editor.toolbar.calloutType`, `editor.callout.plain`, and `editor.callout.{info,tip,success,warning,danger}` in both locales. Korean: 인용 / 정보 / 팁 / 성공 / 경고 / 위험.

- [ ] **Step 2: Write the failing menu test**

```tsx
it('marks the active type checked, so a screen reader hears which one is in effect', () => {
  renderWithI18n(<CalloutMenu current="warning" onChoose={vi.fn()} onDismiss={vi.fn()} />);
  expect(screen.getByRole('menuitemradio', { name: '경고', checked: true })).toBeInTheDocument();
  expect(screen.getByRole('menuitemradio', { name: '인용', checked: false })).toBeInTheDocument();
});

it('offers exactly the roster plus a plain quote', () => {
  renderWithI18n(<CalloutMenu current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />);
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(CALLOUT_TYPES.length + 1);
});
```

- [ ] **Step 3: Run → FAIL. Step 4: build `CalloutMenu.tsx` mirroring `HighlightMenu.tsx`. Step 5: run → PASS.**

- [ ] **Step 6: Add `setCalloutType` and the input rule**

`setCalloutType` wraps in a blockquote if needed, sets `callout`, and inserts an empty `calloutTitle` when there is none — or, for `null`, clears the attribute and unwraps the title into a paragraph. The input rule fires on `> [!warning] ` typed at a line start.

**Read the state through `editorState.ts`'s selector, never `isActive` in a render body** — `useEditor` does not re-render on transactions.

- [ ] **Step 7: Wire the chevron in `BottomToolbar`** beside `quote`, exactly as `highlight` does it, with the same `pr-0.5 pl-2` pairing so the two read as one control.

- [ ] **Step 8: Run the toolbar tests** → PASS. Verify the pressed state changes by driving a real transaction, not by re-render.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(editor): the Quote button gains a callout chevron"
```

---

### Task 7: Export

**Files:**
- Modify: `src/features/export/html.ts`
- Test: `src/features/export/html.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces: an exported document whose callouts carry fill, edge and icon.

- [ ] **Step 1: Write the failing mirror test**

```ts
it('declares the same callout icons in the export stylesheet as the editor does', () => {
  // Mirrored CSS drifting silently is this repo's most-repeated failure shape;
  // `KNOWN_FLATTENED_COLLISIONS` already has to be mirrored the same way.
  const editorCss = readFileSync('src/styles/editor.css', 'utf8');
  for (const type of CALLOUT_TYPES) {
    const mask = /* the data: URI for `type` */;
    expect(editorCss).toContain(mask);
    expect(EXPORT_STYLESHEET).toContain(mask);
  }
});
```

Extract the five `mask-image` URIs to `callouts.ts` as `CALLOUT_ICON_MASKS: Record<CalloutType, string>` so both stylesheets are generated from one source rather than compared as strings.

- [ ] **Step 2: Run → FAIL. Step 3: add tokens to `EXPORT_TOKEN_NAMES`, fallbacks to `FALLBACKS`, and the block to the export stylesheet. Step 4: run → PASS.**

- [ ] **Step 5: Verify a real PDF.** `npm run pdf:up && npm run shots:pdf`, then **count the files** — it skips silently without `PDF_RENDERER_URL`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(export): callouts survive HTML and PDF with their colour and icon"
```

---

### Task 8: The note list preview

**Files:**
- Modify: `src/features/notes/format.ts`
- Test: `src/features/notes/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('strips a callout marker from the preview but keeps its title', () => {
  // The title is the most informative text in the block; the marker is syntax.
  expect(deriveSnippet('Note\n> [!warning] 백업 전에 확인\n>\n> 되돌릴 수 없습니다.')).toBe(
    '백업 전에 확인 되돌릴 수 없습니다.',
  );
});
```

- [ ] **Step 2: Run → FAIL** (shows `[!warning]`).

- [ ] **Step 3: Add `/^\[![^\]\n]+\]\s?/` to `BLOCK_MARKERS`,** after the `>` rule that exposes it.

- [ ] **Step 4: Run → PASS. Step 5: Commit.**

---

### Task 9: End-to-end, screenshots, and the written record

**Files:**
- Create: `e2e/callouts.spec.ts`
- Modify: `e2e/fixtures/corpus.ts`, `e2e/shots.spec.ts`, `CLAUDE.md`, `docs/rulings/markdown-and-schema.md`, `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/accessibility.md`

- [ ] **Step 1: Write `e2e/callouts.spec.ts`** — seed a note with all five types, assert each renders with its `data-callout`, assert the chevron menu switches a type and the note text changes, assert Playwright's viewport-≥1024 assumption is not newly depended on.

- [ ] **Step 2: Add a callout note to the corpus and a shot to `shots.spec.ts`.** Shot count moves 14×16=224 → **15×16=240**. Update the number in CLAUDE.md. **Count the files; do not trust the exit code.**

- [ ] **Step 3: Write the rulings.** The Markdown contract and alias table into `markdown-and-schema.md`; the token derivation and contrast rows into `design-tokens-and-layout.md`; the `menuitemradio` semantics and the colour-is-not-the-only-carrier rule into `accessibility.md`. Extend each file's `**Trigger:**` line and add the row to CLAUDE.md's table.

- [ ] **Step 4: Update CLAUDE.md's status table** — M9b `deferred` → `complete` — and its test counts.

- [ ] **Step 5: Run all six gates.**

- [ ] **Step 6: Commit.**

---

## Self-Review

**Spec coverage.** §3 contract → Tasks 1, 3. §3.4 unknown markers → Task 1. §4 document shape → Task 1. §4.1 sanitize → Task 2. §5 placeholder → Task 5 (CSS) + Task 6 (i18n options). §6 colour → Task 4. §6.1 contrast → Task 4. §7 icons → Tasks 5, 7. §8 export → Task 7. §9 creation → Task 6. §10 order → task order. §11 out of scope → nothing implements it. §12 → Task 9's rulings.

**Placeholders.** One remains by design: Task 7 Step 1's `/* the data: URI for type */`, because the five SVG paths are chosen while drawing them in Task 5 and inventing them here would be a guess. The step says where they live (`CALLOUT_ICON_MASKS` in `callouts.ts`) and that both stylesheets must be generated from that one source, which is the part a reviewer needs.

**Type consistency.** `CalloutType`, `CALLOUT_TYPES`, `parseMarker`, `formatMarker`, `CALLOUT_ICON_MASKS`, `setCalloutType`, `calloutType` on `EditorFlags`, and the `data-callout` / `data-callout-title` attributes are spelled identically in every task that names them.

**Known risk.** Task 6's `setCalloutType` is the only command that restructures content (inserting and removing `calloutTitle`). Dispatching inside a Tiptap command throws `RangeError: Applying a mismatched transaction` — work through the `tr`/`state`/`dispatch` the command is handed, never `view.dispatch`.
