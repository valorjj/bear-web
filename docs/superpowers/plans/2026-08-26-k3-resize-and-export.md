# K3 — Resize and images in export: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set how wide an image displays, and get it out of the app as HTML, PDF or a Markdown bundle.

**Architecture:** A display width rides in the Markdown as Obsidian's `![alt|640](…)` pipe convention, so it travels with the note through sync and export. HTML and PDF inline the bytes as `data:` URIs, which keeps the PDF renderer's no-egress isolation intact; Markdown becomes a store-only zip carrying `files/`.

**Tech Stack:** Tiptap v3 (`StoredImage`), Dexie, Vitest, Playwright, Hono. **No new dependency** — the zip writer is hand-written.

**Spec:** `docs/superpowers/specs/2026-08-26-k3-resize-and-export-design.md`

## Global Constraints

- **All six gates before any commit:** `npm run typecheck`, `npm run lint`, `npm run format`, `npm test -- --run --maxWorkers=4`, `npm run build`, `npm run test:e2e`.
- **`src/features/export/html.ts` must not import from `src/data/`.** It is handed what it needs, the way `readExportTokens` takes the document rather than reaching for it.
- **`server/` may import only `src/data/types.ts`.**
- **A backtick inside a CSS comment in `html.ts` terminates the template literal** holding the export stylesheet, breaking ten unrelated test files with an error that points at the prose.
- **The Markdown round trip must stay byte-identical.** An image with no width must serialise back exactly as K1 wrote it. `CANONICAL` in `src/features/editor/markdown.test.ts` is where both shapes go.
- **`MAX_EXPORT_BYTES` rises 2 MiB → 20 MiB.** Sized against the quota's arithmetic: 2048px q80 lands 200–600 KB, so 20 MiB is roughly 25 images.
- **jsdom has no `setPointerCapture` and no layout.** Pointer drags belong in Playwright; the keyboard path belongs in unit tests.
- **Export runs behind a session for PDF only.** Markdown and HTML are local and must keep working signed out.
- **Before any e2e run following a source change:** `lsof -ti:4173 | xargs -r kill -9`.

---

### Task 1: the pipe-width grammar

**Files:**

- Modify: `src/data/images/storedImagePath.ts`, `src/data/images/storedImagePath.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const MAX_DISPLAY_WIDTH = 2048`
  - `export interface ImageAlt { alt: string; width: number | null }`
  - `export function parseImageAlt(raw: string): ImageAlt`
  - `export function formatImageAlt(alt: string, width: number | null): string`

Lives beside `storedImagePath` because it is the same contract — what the app writes into a note's Markdown — and `src/data/` is the one place both the editor and the export path may import from.

- [ ] **Step 1: Write the failing test**

```ts
describe('parseImageAlt', () => {
  it('splits a numeric suffix into a width', () => {
    expect(parseImageAlt('beach|640')).toEqual({ alt: 'beach', width: 640 });
  });

  it('accepts a width with no alt', () => {
    expect(parseImageAlt('|640')).toEqual({ alt: '', width: 640 });
  });

  it('leaves a NON-numeric suffix as part of the alt text', () => {
    // Not a malformed width: `a|b` is what every other Markdown reader will
    // show as alt text, and guessing otherwise would silently lose a
    // character the user typed.
    expect(parseImageAlt('a|b')).toEqual({ alt: 'a|b', width: null });
  });

  it('takes the LAST pipe, so an alt containing one still works', () => {
    expect(parseImageAlt('a|b|640')).toEqual({ alt: 'a|b', width: 640 });
  });

  it('has no width when there is no pipe', () => {
    expect(parseImageAlt('beach')).toEqual({ alt: 'beach', width: null });
  });

  it.each([
    ['zero', '|0', null],
    ['negative', '|-5', null],
    ['a decimal', '|64.5', null],
  ])('rejects %s as a width', (_what, raw, expected) => {
    expect(parseImageAlt(raw).width).toBe(expected);
  });

  it('clamps a width above the maximum', () => {
    // A note edited by hand can carry anything, and a 999999px image is a
    // broken layout whose cause the user cannot see.
    expect(parseImageAlt(`|${MAX_DISPLAY_WIDTH + 500}`).width).toBe(MAX_DISPLAY_WIDTH);
  });
});

describe('formatImageAlt', () => {
  it('omits the pipe entirely when there is no width', () => {
    // Load-bearing: an image nobody resized must round-trip byte-identically
    // to what K1 wrote.
    expect(formatImageAlt('beach', null)).toBe('beach');
  });

  it('writes the width after a pipe', () => {
    expect(formatImageAlt('beach', 640)).toBe('beach|640');
  });

  it('round-trips every shape', () => {
    for (const raw of ['beach', 'beach|640', '|640', 'a|b']) {
      const parsed = parseImageAlt(raw);
      expect(formatImageAlt(parsed.alt, parsed.width)).toBe(raw);
    }
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/data/images/storedImagePath.test.ts`

- [ ] **Step 3: Implement**

Split on the LAST `|`. A suffix matching `/^[0-9]+$/` with a value ≥ 1 is a width, clamped to `MAX_DISPLAY_WIDTH`; anything else leaves the raw string as the alt.

- [ ] **Step 4: Run the test**

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data/images
git commit -m "feat(images): a display width in the alt text, Obsidian-style"
```

---

### Task 2: the width on the node, and in the round trip

**Files:**

- Modify: `src/features/editor/StoredImage.ts`, `src/features/editor/RawBlock.ts`, `src/features/editor/markdown.test.ts`, `src/features/editor/storedImage.test.tsx`

**Interfaces:**

- Consumes: `parseImageAlt`, `formatImageAlt` (Task 1).
- Produces: `StoredImage` gains a `width: number | null` attribute.

- [ ] **Step 1: Add the round-trip fixtures FIRST**

In `CANONICAL`:

```ts
{ name: 'stored image with width', markdown: '![beach|640](files/abc123.webp)' },
{ name: 'stored image, width only', markdown: '![|640](files/abc123.webp)' },
```

The existing `{ name: 'stored image', markdown: '![beach](files/abc123.webp)' }` stays and is the byte-identical guarantee for an unresized image.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/features/editor/markdown.test.ts`
Expected: FAIL — the width is dropped, so `![beach|640](…)` comes back as `![beach](…)`.

- [ ] **Step 3: Implement**

`RawBlock.ts`'s branch runs `parseImageAlt(token.text)` and puts `alt` and `width` on the node. `StoredImage.renderMarkdown` emits `![${formatImageAlt(alt, width)}](${src})`. The node view sets `style.width` in pixels when a width is set and leaves it unset otherwise — **a `width` attribute AND a CSS width would fight**, and the CSS one is what a resize must move.

- [ ] **Step 4: Add the node test**

```tsx
it('renders at the width the Markdown asks for', async () => {
  // …seed a file, mount `![|120](files/<id>.webp)`, assert the rendered
  // element's inline width is 120px.
});

it('fills the column when no width is set', async () => {
  // The K1 default, and the thing a wrong `style.width = '0px'` would break
  // invisibly.
});
```

- [ ] **Step 5: Run the editor suite**

Run: `npx vitest run src/features/editor/`

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor
git commit -m "feat(images): a stored image carries its display width"
```

---

### Task 3: resizing — keyboard first

**Files:**

- Modify: `src/features/editor/StoredImage.ts`, `src/features/editor/storedImage.test.tsx`, `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `MAX_DISPLAY_WIDTH` (Task 1).
- Produces: keyboard shortcuts `Mod-Alt-ArrowRight` / `Mod-Alt-ArrowLeft` / `Mod-Alt-0` on a selected `storedImage`.

**Keyboard before pointer, deliberately.** The pointer path cannot be unit tested at all, so building it first would mean building the harder half with no feedback. The keyboard path also settles the command and the clamping, which the drag then reuses.

- [ ] **Step 1: Write the failing tests**

```tsx
it('narrows a selected image by a step', async () => {
  // Select the node, press Mod-Alt-ArrowLeft, assert the SERIALIZED markdown
  // carries a smaller width — the document, not just the DOM.
});

it('never goes below 1 or above the maximum', async () => {
  // Pressing left twenty times must not produce a zero-width image, and
  // pressing right twenty times must not exceed MAX_DISPLAY_WIDTH.
});

it('resets to full column', async () => {
  // Mod-Alt-0 clears the width, and the markdown loses the pipe entirely —
  // not `|0`, which would parse back as no width anyway and is a different
  // byte sequence.
});

it('does nothing when no image is selected', async () => {
  // The chords must not swallow themselves when the caret is in prose.
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/features/editor/storedImage.test.tsx`

- [ ] **Step 3: Implement**

`addKeyboardShortcuts` on the node, acting only when the selection is a `NodeSelection` on a `storedImage`. A step is 10% of the current width, or of the measured column width when none is set, floored at 1 and capped at `MAX_DISPLAY_WIDTH`. `Mod-Alt-0` sets `width: null`.

**Do not dispatch inside a Tiptap command.** `editor.commands.X()` opens its own transaction and a nested `view.dispatch` throws `RangeError: Applying a mismatched transaction`. Work through the `tr`/`dispatch` the shortcut is handed.

- [ ] **Step 4: Run the tests**

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor src/i18n
git commit -m "feat(images): resize from the keyboard"
```

---

### Task 4: resizing — the drag handle

**Files:**

- Modify: `src/features/editor/StoredImage.ts`, `src/styles/editor.css`
- Create: `e2e/imageResize.spec.ts`

**Interfaces:**

- Consumes: Task 3's width command.
- Produces: nothing new; a pointer route to the same behaviour.

- [ ] **Step 1: Implement the handle**

A `contenteditable="false"` span on the image's right edge inside the node view, revealed on hover or focus-within — the same pattern the table handles use, and **44×44** because J2a's rule applies to every new control, not only the ones on a phone.

`pointerdown` captures the pointer and the starting width; `pointermove` sets `style.width` LIVE without touching the document; `pointerup` writes the final width through Task 3's command **once**. A width per pointer event would put a hundred transactions and a hundred sync-dirty marks through `notes.save` for one drag.

- [ ] **Step 2: Write the e2e**

```ts
test('dragging the handle resizes the image, and it survives a reload', async ({ page }) => {
  // Paste an image, read its rendered width, drag the handle left by 100px,
  // assert the rendered width shrank by about that, reload, reopen, and
  // assert it is still the new width.
});
```

The reload half is the point: a resize that only changes the DOM and never reaches the Markdown would pass every in-page assertion.

- [ ] **Step 3: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/imageResize.spec.ts
```

- [ ] **Step 4: Prove it can fail**

Make `pointerup` not write the width. The reload assertion must fail while the in-page one still passes — which is exactly why the test reloads.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src e2e
git commit -m "feat(images): drag the right edge to resize"
```

---

### Task 5: inlining images into HTML and PDF

**Files:**

- Modify: `src/features/export/html.ts`, `src/features/export/exportNote.ts`, `src/features/export/html.test.ts`, `server/src/routes/export.ts`

**Interfaces:**

- Consumes: `storedImageIds` from `@/data`.
- Produces: `renderNoteHtml(note, tokens, locale, images?: Map<string, string>)` — id → data URI. `exportNote` resolves the map before calling it.

- [ ] **Step 1: Write the failing test**

```ts
it('inlines a stored image as a data URI', () => {
  const html = renderNoteHtml(note('![](files/abc.webp)'), tokens, 'en', new Map([['abc', 'data:image/webp;base64,AAA']]));

  expect(html).toContain('src="data:image/webp;base64,AAA"');
  // The relative path must be GONE: an exported file that still points at
  // `files/abc.webp` is broken everywhere it is opened.
  expect(html).not.toContain('files/abc.webp');
});

it('leaves an image with no supplied bytes out rather than emitting a dead path', () => {
  // A note whose image has not synced yet. A dead `src` renders as a broken
  // icon in every reader; nothing renders as nothing.
});

it('keeps the width when one is set', () => {
  const html = renderNoteHtml(note('![|300](files/abc.webp)'), tokens, 'en', images);

  expect(html).toMatch(/width:\s*300px/);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/features/export/html.test.ts`

- [ ] **Step 3: Implement**

`renderNoteHtml` takes the optional map and rewrites `src` when it has bytes. `exportNote` builds it: `storedImageIds(note.text)` → `files.get` → base64. **`html.ts` still imports nothing from `src/data/`** — the map is handed in.

- [ ] **Step 4: Raise the server's cap**

`server/src/routes/export.ts`: `MAX_EXPORT_BYTES` 2 MiB → 20 MiB, with the arithmetic in the comment (600 KB WebP ≈ 800 KB base64; 20 MiB ≈ 25 images). Update `export.test.ts`'s over-limit test to the new number.

- [ ] **Step 5: Run both suites**

```bash
npx vitest run src/features/export/
npm test -- --run server/src/routes/export.test.ts
```

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/export server/src/routes
git commit -m "feat(export): HTML and PDF carry their images"
```

---

### Task 6: the zip writer

**Files:**

- Create: `src/lib/zip.ts`, `src/lib/zip.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function createZip(entries: Array<{ path: string; bytes: Uint8Array }>): Blob`.

`src/lib/` because it is a pure format with no product knowledge — the same reason `useAnchoredMenu` lives there.

- [ ] **Step 1: Write the failing test**

The assertion that matters is that a REAL unzipper accepts it. Node's `zlib` cannot read a zip container, so the test parses the central directory back by hand AND the e2e in Task 7 opens it with a real tool.

```ts
it('writes a readable central directory', () => {
  const zip = createZip([{ path: 'a.txt', bytes: new TextEncoder().encode('hello') }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());

  // End of central directory signature, at the end.
  expect(readUint32(bytes, bytes.length - 22)).toBe(0x06054b50);
  expect(readUint16(bytes, bytes.length - 12)).toBe(1); // one entry
});

it('stores bytes verbatim, uncompressed', () => {
  // Method 0. WebP is already compressed; deflate would spend CPU to save
  // nothing, and STORE is what keeps this dependency-free.
});

it('round-trips a nested path', () => {
  // `files/x.webp` must keep its forward slash — a backslash here is what
  // makes a zip open as one file named `files\x.webp` on some tools.
});

it('computes a CRC-32 that matches a known value', () => {
  // The one piece that is arithmetic rather than layout, and the one a
  // structural test would not catch: a wrong CRC opens as a corrupt archive.
  expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/lib/zip.test.ts`

- [ ] **Step 3: Implement**

Local file header, bytes, central directory, EOCD. Method 0, no data descriptors, DOS timestamp fixed at a constant so the output is deterministic and two exports of the same note are byte-identical.

- [ ] **Step 4: Run the tests**

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/lib/zip.ts src/lib/zip.test.ts
git commit -m "feat(export): a store-only zip writer, no dependency"
```

---

### Task 7: Markdown as a bundle

**Files:**

- Modify: `src/features/export/exportNote.ts`, `src/features/export/filename.ts`, `src/features/export/exportNote.test.ts`
- Create: `e2e/imageExport.spec.ts`

**Interfaces:**

- Consumes: `createZip` (Task 6), `storedImageIds`.
- Produces: no new exports; `exportNote(note, 'md', …)` now produces a `.zip` when the note has stored images.

- [ ] **Step 1: Write the failing tests**

```ts
it('exports a plain .md when the note has no images', () => {
  // A zip holding one file would make every ordinary export worse to serve
  // one case.
  expect(download.mock.calls[0][0]).toMatch(/\.md$/);
});

it('exports a .zip holding the note and its files when it has images', () => {
  expect(download.mock.calls[0][0]).toMatch(/\.zip$/);
});

it('keeps the Markdown text VERBATIM inside the bundle', () => {
  // `files/<id>.webp` must survive untouched — that relative path is the
  // whole reason the bundle opens in Obsidian.
});

it('omits an image whose bytes are missing, and still exports', () => {
  // A note synced before its image arrived must not fail to export.
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/features/export/exportNote.test.ts`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Write the e2e that opens the zip with a REAL tool**

```ts
test('a Markdown export is a bundle that unzips with the image intact', async ({ page }) => {
  // Paste an image, export as Markdown, catch the download, and run
  // `unzip -l` (or Node's own reader) over the saved file — asserting the
  // .md AND files/<id>.webp are both listed.
});
```

Our own parser agreeing with our own writer proves nothing about whether anything else can open it.

- [ ] **Step 5: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/imageExport.spec.ts
```

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src e2e
git commit -m "feat(export): Markdown exports as a bundle Obsidian can open"
```

---

### Task 8: the PDF, checked in pixels

**Files:**

- Modify: `e2e/shots-pdf.spec.ts`, `server/pdf/fidelity.test.ts`

- [ ] **Step 1: Add an image to the PDF shot corpus**

The corpus note gains a stored image so the rasterised page has one to find.

- [ ] **Step 2: Assert on PIXELS, not text**

A text extraction cannot see a missing image, exactly as it cannot see tofu — `toContain('…')` passes on a page of empty rectangles. The assertion is that the region where the image should be is NOT uniform, using the same rasterise-and-measure approach `server/pdf/inspectPdf.ts` already provides.

- [ ] **Step 3: Run it**

```bash
npm run pdf:up
PDF_RENDERER_URL=http://127.0.0.1:8788 npm run shots:pdf
```

**Count the files.** It skips silently without `PDF_RENDERER_URL`.

- [ ] **Step 4: LOOK at the rasterised page**

Nothing else can tell you the image is the right size, in the right place, and not clipped by the page margin.

- [ ] **Step 5: Commit**

```bash
git add e2e server/pdf
git commit -m "test(export): the PDF's image, asserted in pixels"
```

---

### Task 9: rulings and CLAUDE.md

**Files:** `docs/rulings/markdown-and-schema.md`, `docs/rulings/export.md`, `CLAUDE.md`, `docs/superpowers/NEXT.md`

- [ ] **Step 1: Record the rulings**

`markdown-and-schema.md`: the pipe-width grammar and each parsing rule, especially that a non-numeric suffix stays alt text; that the pipe is omitted when no width is set, so an unresized image round-trips byte-identically.

`export.md`: HTML and PDF inline as data URIs and why that keeps the renderer's isolation; `MAX_EXPORT_BYTES` at 20 MiB with the arithmetic; the Markdown bundle and why a note with no images stays a plain `.md`; the store-only zip and why no dependency.

- [ ] **Step 2: Update CLAUDE.md** — the K3 row, the real test counts, and that `src/lib/zip.ts` is a hand-written format whose correctness rests on an external unzipper rather than our own reader.

- [ ] **Step 3: Full gate**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
```

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md && git commit -m "docs(k3): record the resize and export rulings"
```

---

## Self-review

**Spec coverage.** Pipe grammar → Task 1. Node attribute and round trip → Task 2. Keyboard resize → Task 3. Drag → Task 4. HTML/PDF inlining and the cap → Task 5. Zip → Task 6. Markdown bundle → Task 7. PDF pixels → Task 8. Docs → Task 9. The spec's non-goals (cropping, remote-URL handles, re-encoding) are untouched by every task.

**Placeholders.** Tasks 2, 3, 4 and 7 carry test sketches whose bodies are described rather than written; each names the exact assertion and why it is the one that can fail. That is deliberate for the editor tests, whose harness must be copied from `storedImage.test.tsx` as it actually is rather than from a guess — this project has been bitten by a plan that invented a component signature.

**Type consistency.** `parseImageAlt` / `formatImageAlt` / `MAX_DISPLAY_WIDTH` defined in Task 1 are used under those names in Tasks 2 and 3. `createZip(entries)` defined in Task 6 is called in Task 7. `renderNoteHtml`'s fourth parameter is introduced in Task 5 and used only there.
