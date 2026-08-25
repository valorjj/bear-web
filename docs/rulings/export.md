# Export

Governs how a note leaves the app as Markdown, HTML or PDF: which pipeline renders it, what the exported document is allowed to change, and how it gets its colours and its print behaviour.

**Trigger:** any change under `src/features/export/` — `html.ts` (`renderNoteBody`, `renderNoteHtml`, `readExportTokens`, `EXPORT_TOKEN_NAMES`, `FALLBACKS`, the inline `<style>` block), `exportNote.ts` (`exportNote`, `MIME`), `requestPdf.ts` (`requestPdf`, `PdfFailure`, `BY_STATUS`), `filename.ts`, `ExportMenu.tsx`; `NoteEditor.handleExport` in `src/features/notes/NoteEditor.tsx`; `server/src/routes/export.ts`, `server/pdf/` (`render.ts`'s `emulateMedia`/`preferCSSPageSize`, `inspectPdf.ts`, `fidelity.test.ts`); the `export.*` keys in `src/i18n/en.ts` / `ko.ts` and the `ALLOWED_IDENTICAL` list in `i18n.test.tsx`; the export blocks in `e2e/notes.spec.ts` and `e2e/pdfExport.spec.ts`; and any new import of `marked` or `@tiptap/markdown` outside `src/features/editor/markdown.ts`.

- **Export renders through the EDITOR'S OWN SCHEMA, never a second Markdown
  pipeline.** `renderNoteBody` parses with `parseMarkdown` — the single importer
  of `@tiptap/markdown` — and serializes with ProseMirror's `DOMSerializer`
  against `getSchema(editorExtensions)`. So an export cannot disagree with what
  the editor shows, and the two-implementations-of-one-grammar defect never
  appears. Reaching for `marked` directly in export code would reintroduce it.

- **A construct with no node in the schema exports as its own Markdown source,
  and that is the fallback working.** It becomes a `<pre data-raw-block="…">` of
  that source in the exported HTML and PDF, exactly as it appears in the editor,
  styled as a quoted block rather than as code. **The example used to be a table
  and no longer is** — M8c gave tables a real node, so a table now exports as a
  real `<table>`; the live cases are raw HTML blocks (`rawHtmlBlock`), reference
  definitions (`rawDefinition`), images (`rawImage`) and inline raw HTML. Both
  halves are pinned in `src/features/export/html.test.ts`: a table must contain
  `<table` and NOT `data-raw-block="`, a raw HTML block must still fall back.
  Do not "fix" the fallback in the export layer; fixing it downstream would make
  the export disagree with the editor. Giving a construct a real node is the
  right fix, as tables demonstrate.

- **Markdown export is the note's text VERBATIM.** No normalization, no
  re-serialization. The text is already canonical Markdown, so putting it back
  through the serializer could only change it, and an export that rewrites a
  byte of the user's own file is the one thing this must not do.

- **Export uses the LIVE editor text, not `note.text`.** The stored record lags
  the editor by the autosave debounce, so exporting it hands the user a file
  missing their last few seconds of typing. `NoteEditor.handleExport` reads
  `handleRef.current.getMarkdown()` and derives the title from that same text
  via `deriveTitle(text)`.

- **PDF is rendered SERVER-SIDE, and needs an account.** It was the browser's
  own print pipeline into a hidden same-origin iframe until sub-project G;
  `src/features/export/print.ts` is deleted and the ruling that named it is
  superseded by this one. `requestPdf` POSTs the document `renderNoteHtml`
  produced to `POST /export/pdf`, an authenticated pass-through
  (`server/src/routes/export.ts`) in front of a separate Chromium container
  (`server/pdf/`). **PDF is the first capability in this app that does not
  exist without an account** — `ExportMenu` marks the item `aria-disabled`
  (never the HTML attribute, which would drop it out of the tab order and
  leave a keyboard user no way to discover why) and names the reason in its
  accessible name.

  The reason to leave the browser at all was fidelity, not capability: a
  print dialog gives the user a dozen ways to produce a document that is not
  the one the app designed — the wrong paper, scaled, backgrounds stripped,
  headers and footers added — and no way for the app to know. The server
  pins all of it.

- **The CLIENT still builds the document; the server only rasterises it.**
  `renderNoteHtml` runs in the browser, and it must: it reads the live theme
  tokens off the cascade (`readExportTokens`) and the live editor text, and
  `server/` may import nothing from `src/` but `src/data/types.ts`
  (`scripts/serverBoundaries.test.ts`). The server never sees a note, a tag or
  a theme id — only one self-contained HTML document and only from a
  signed-in session.

- **Four of the spec's five security controls are built; the fifth is not.**
  The four: every subresource request aborted (`page.route('**', …)` in
  `render.ts`), `javaScriptEnabled: false` on the render context,
  `setContent` and never `goto` (no client-controlled URL and no `file://`),
  and bounded resources (a fresh context per render closed in a `finally`, a
  wall-clock deadline, a queue, `mem_limit: 1g`, `pids_limit: 512` in
  `server/docker-compose.yml`). The spec's control 4 — "the container has no
  route off the host" — **is NOT satisfied**: `internal: true` denies egress
  and also kills the published port, so the API could never reach the
  renderer, and was rejected for that reason. `--host-resolver-rules=MAP *
  ~NOTFOUND` at browser launch is a mitigation layer on top of that gap, not
  control 4 itself — it blocks the renderer's own DNS/IP resolution, but the
  container keeps a real route to the internet that only the browser is kept
  off. See `server/README.md`'s "What actually contains it" for the egress
  layers in detail; the four controls above are not enumerated there as a
  list.

- **`emulateMedia({ media: 'screen' })` and `preferCSSPageSize: true` are the
  whole fidelity claim, and nothing cheaper can see them.** `page.pdf()`
  applies PRINT media by default, which is precisely how "the PDF ignores your
  theme" happens. `%PDF-` prefix checks, byte lengths and text extractions all
  pass on a white page with a print stylesheet applied, so they prove nothing
  about it. `server/pdf/fidelity.test.ts` renders a probe document whose page
  size, page colour and text indent each differ between the two media, and
  reads them back out of the content stream with `server/pdf/inspectPdf.ts`;
  `e2e/pdfExport.spec.ts` does the same to a real Nord export from the real
  container, by hand — CI has no renderer (the image is 3.92 GB), so that
  test skips there without `PDF_RENDERER_URL`. Flip either option and
  `fidelity.test.ts` goes red in CI; `e2e/pdfExport.spec.ts` goes red too, but
  only where the container is actually running.

- **The theme owns the page, printed or not.** `@media print` in the export
  stylesheet must not reset `html`/`body`'s background — a dark theme prints a
  dark page. The unit assertion in `html.test.ts` names one selector and would
  miss a reset written against another, so the real guard is
  `e2e/pdfExport.spec.ts`, which flips the test browser's own media type and
  compares the PAINTED background (resolved; a `getPropertyValue` on a derived
  token hands back the literal `color-mix(…)`).

- **A text extraction cannot see tofu, and this is the export suite's standing
  trap.** A PDF whose every Korean glyph rendered as a missing-glyph box still
  contains the right text — the string comes from the font's cmap, not from
  what was drawn — so `expect(text).toContain('자산화')` passes on a page of
  empty rectangles. Same shape as a white-on-white page passing a text
  assertion. This is why `server/docker/pdf/verify-fonts.mjs` asserts the
  embedded `/BaseFont` names in a really-rendered PDF at BUILD time, and why
  `npm run shots:pdf` rasterises four themes for a human to look at. `fc-match`
  is not evidence either: it answered correctly while every code block
  rendered in a fallback face.

- **The export stylesheet carries its own reset, and it is load-bearing.** The
  app gets one from Tailwind's preflight; a standalone file gets none, so the
  browser's default paragraph margin applies INSIDE a flex task item and the
  item stands three lines tall with its checkbox above its text. **The obvious
  assertion cannot see this**: the checkbox and its label still overlap
  vertically in the broken state, so the overlap check written first passed
  under fault injection. The test that works loads the downloaded file with
  `page.goto('file://…')` and measures the item's height against its own
  computed `line-height` (`e2e/notes.spec.ts`). The download must be saved under
  a real `.html` name first — Playwright's own download path has no extension,
  and Chromium then serves it as plain text, so every geometry assertion finds
  nothing.

- **Export colours are read from the live cascade, never hardcoded.**
  `readExportTokens` resolves each of `EXPORT_TOKEN_NAMES` off
  `document.documentElement` at export time, which keeps colour literals out of
  `src/` as the token rule requires and makes an export carry whatever theme the
  user is looking at. The per-token fallbacks are CSS SYSTEM COLOURS (`canvas`,
  `canvastext`, `linktext`, `graytext`, `buttonface`, `buttonborder`) rather
  than literals, so a renamed token degrades to the reader's platform palette
  instead of to a blank value — which would render an invisible page.

- **No backtick may appear inside `renderNoteHtml`'s template literal.** One
  terminates it, and the failure surfaces as a TypeScript syntax error pointing
  at a CSS comment. It happened once already, quoting a CSS declaration in a
  comment.

- **`export.html` and `export.pdf` are on the allowlist in `i18n.test.tsx` of
  keys legitimately identical across bundles** (`ALLOWED_IDENTICAL`, alongside
  `app.name`). Korean uses both acronyms verbatim. `export.markdown` is
  deliberately NOT on it — Korean does render that as 마크다운 — so the list stays
  a set of specific exceptions rather than a blanket exemption for the group.
