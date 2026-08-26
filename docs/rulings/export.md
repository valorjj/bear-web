# Export

Governs how a note leaves the app as Markdown, HTML or PDF: which pipeline renders it, what the exported document is allowed to change, and how it gets its colours and its print behaviour.

**Trigger:** any change under `src/features/export/` — `html.ts` (`renderNoteBody`, `renderNoteHtml`, `readExportTokens`, `EXPORT_TOKEN_NAMES`, `FALLBACKS`, the inline `<style>` block), `exportNote.ts` (`exportNote`, `MIME`), `requestPdf.ts` (`requestPdf`, `PdfFailure`, `BY_STATUS`), `filename.ts`, `ExportMenu.tsx`, `useExportRunner.ts`; `NoteEditor.handleExport` in `src/features/notes/NoteEditor.tsx` and the export group in `src/features/notes/NoteRowMenu.tsx`; `server/src/routes/export.ts`, `server/pdf/` (`render.ts`'s `emulateMedia`/`preferCSSPageSize`, `inspectPdf.ts`, `fidelity.test.ts`); the `export.*` keys in `src/i18n/en.ts` / `ko.ts` and the `ALLOWED_IDENTICAL` list in `i18n.test.tsx`; the export blocks in `e2e/notes.spec.ts` and `e2e/pdfExport.spec.ts`; and any new import of `marked` or `@tiptap/markdown` outside `src/features/editor/markdown.ts`.

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

- **The page is painted edge to edge; the inset lives on `body`'s padding,
  never on `@page`'s margin.** `@page { margin }` is Chromium's own unpainted
  band — `printBackground` never reaches it — so a nonzero `@page` margin
  reintroduces the white border a themed PDF must not have (measured on Nord:
  A4's MediaBox 793 x 1123 px vs. a 673 x 986 px painted content box, before
  this was fixed). `@page`'s margin stays `0`; the 18mm/16mm inset is
  `body`'s own `padding` in `html.ts`, inside the painted box like everything
  else. The `@media print` block correspondingly does NOT zero that padding
  (it would run text to the paper edge now that `@page` reserves nothing) —
  it resets only `max-width`, since the line-width cap is a screen-reading
  measure with no place on a printed page.

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

- **`editor.css` and the export's inline `<style>` are two independent
  stylesheets for one document, and a rule can drift between them with no test
  noticing — the same failure family as the `.hljs-*` flattening case above,
  now confirmed for table cells.** An empty table row rendered ~20px tall in
  the exported PDF against ~40px in the editor. Two divergences compounded:
  (1) ProseMirror inserts a trailing `<br>` into every empty block so a caret
  has somewhere to sit, giving an empty `<p>` a real line box in the editor —
  but `DOMSerializer` emits a bare `<p></p>` with no `<br>`, and a paragraph
  with no line box is zero height, so the export's empty cell was padding
  alone. (2) `editor.css`'s `.ProseMirror th > p, .ProseMirror td > p` sets
  `margin: 0`; the export's counterpart at `html.ts` only had `text-indent:
  0` — cell paragraphs are not `body > * + *` siblings, so they fell back to
  the UA sheet's `margin: 1em 0`, invisible on an empty table but capable of
  making populated cells inconsistently tall. Fixed by adding `margin: 0` and
  `min-height: 1lh` to the export's `th > p, td > p` rule — `1lh` reproduces
  the missing line box directly off the same line-height the editor uses,
  rather than a magic-number `min-height` that could silently drift from
  `--bear-line-height`. `html.test.ts`'s "table-cell paragraph rules stay
  parallel between editor and export" describe block guards this: it extracts
  both rules' declaration text via regex (jsdom has no layout engine, so pixel
  height cannot be asserted) and requires the margin reset and an explicit
  non-zero `min-height` on the export side. It goes red if either rule
  regresses — verified against the pre-fix stylesheet.


- **Running an export lives in `useExportRunner`, not in the component that
  offers it.** Two places can start one now: the editor's own export button
  and the note list's row menu. The hook owns the progress pairing and the
  failure-reason table, because the pairing is exactly the kind of thing that
  ends up correct in one copy and wrong in the other — `begin()`/`end()` must
  be paired through `finally`, not merely after the `await`, or a rejection
  anywhere in `exportNote` leaves the top bar spinning and the PDF item
  `aria-busy` forever, which is worse than shipping no loader at all.

- **The row menu exports the STORED record; the editor exports what is on
  screen. Both are right.** The editor's text lags the record by the autosave
  debounce, so exporting `note.text` there would hand the user a file missing
  their last few seconds of typing. A row the user is not editing has nothing
  pending, and the note list has no live editor to read from in any case.

- **`useExportRunner` imports `exportNote` from `./exportNote`, not from its
  own barrel — so a test that mocks `@/features/export` mocks a binding
  nothing under test reads.** This bit once: `NoteEditor.test.tsx` had mocked
  the barrel since G, and the mock silently stopped applying the moment the
  call moved into the hook. The failure was not an error — the real
  `exportNote` ran, rejected for its own reasons, and the assertion on the
  failure SENTENCE was what noticed. Mock the deep module
  (`@/features/export/exportNote`); the barrel re-exports whatever it
  resolves to, so `vi.mocked(exportNote)` imported from the barrel is still
  the same spy.


## Images in export (K3)

- **HTML and PDF INLINE their images as `data:` URIs.** Not a convenience: the
  PDF renderer runs in a container with deliberately no route off the host
  (G's control 4 reasoning), so it could not fetch `files/<id>.webp` even if
  the path were absolute. Inlining is what lets that isolation stay intact
  while the image still arrives.

- **An image whose bytes are missing is REMOVED from the output**, never left
  pointing at a dead path. A note synced before its image arrived still
  exports, without a broken-image icon in the middle of it.

- **`MAX_EXPORT_BYTES` is 20 MiB, and the number is arithmetic.** A stored
  image is 2048px at q80 — 200–600 KB — and base64 adds a third, so ~800 KB
  each. At the old 2 MiB a note with three screenshots was already refused. 20
  MiB carries roughly 25 images and still bounds what one request can push into
  a Mac Mini's memory.

- **`html.ts` still imports nothing from `src/data/`.** The image map is
  resolved by `exportNote` and handed in, the same boundary `readExportTokens`
  keeps by taking the document rather than reaching for it.

- **K1's privacy rule survives export.** A remote URL renders as source, never
  an `<img>`, in the exported file too — an exported document that fetches from
  a third-party host when opened is the same beacon, just posted somewhere
  else. There is a test.

- **Markdown exports a store-only `.zip` when the note has images, and a plain
  `.md` when it does not.** A zip holding one file would make every ordinary
  export worse to serve one case. The text goes in VERBATIM so
  `files/<id>.webp` survives — that relative path is the whole reason the
  folder resolves its images in Obsidian, and it is why K1 chose a relative
  path over a scheme.

- **`src/lib/zip.ts` is hand-written, and its correctness rests on an EXTERNAL
  unzipper.** Every entry is a WebP, already compressed, so deflate would spend
  CPU to save nothing — which leaves four record types and no algorithm, small
  enough to own rather than import. `src/lib/zip.test.ts` reads the archive
  back with our own parser, which proves only that reader and writer share
  whatever misunderstanding they have; `e2e/imageExport.spec.ts` runs
  `unzip -t`, and that is the only thing in the repo that can catch a wrong
  CRC-32 — a perfectly-shaped archive that reports itself corrupt.

- **The PDF's image is asserted STRUCTURALLY, not by text.** A text extraction
  cannot see a missing image any more than it can see tofu: the surrounding
  words are present either way. `server/pdf/fidelity.test.ts` asserts an
  embedded image XObject with a real `/Width`, which exists only when Chromium
  decoded the inlined bytes.
