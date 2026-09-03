# Export

Governs how a note leaves the app as Markdown, HTML or PDF: which pipeline renders it, what the exported document is allowed to change, and how it gets its colours and its print behaviour.

**Trigger:** any change under `src/features/export/` — `html.ts` (`renderNoteBody`, `renderNoteHtml`, `readExportTokens`, `EXPORT_TOKEN_NAMES`, `FALLBACKS`, the inline `<style>` block, `collectDiagramSources`, `replaceMermaidBlocks`), `exportNote.ts` (`exportNote`, `MIME`, `collectDiagrams`), `requestPdf.ts` (`requestPdf`, `PdfFailure`, `BY_STATUS`), `filename.ts`, `ExportMenu.tsx`, `useExportRunner.ts`; `NoteEditor.handleExport` in `src/features/notes/NoteEditor.tsx` and the export group in `src/features/notes/NoteRowMenu.tsx`; `server/src/routes/export.ts`, `server/pdf/` (`render.ts`'s `emulateMedia`/`preferCSSPageSize`, `inspectPdf.ts`, `fidelity.test.ts`, `mermaid.ts`, `mermaidTheme.ts`); the `export.*` keys in `src/i18n/en.ts` / `ko.ts` and the `ALLOWED_IDENTICAL` list in `i18n.test.tsx`; the export blocks in `e2e/notes.spec.ts` and `e2e/pdfExport.spec.ts`; and any new import of `marked` or `@tiptap/markdown` outside `src/features/editor/markdown.ts`; `src/features/publish/` (`PublishDialogContainer.handlePublish`'s `buildHtml`, `requestPublish.ts`), `server/src/routes/publish.ts` and `server/src/routes/publicPage.ts`.

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


- **The user's parity ruling, 2026-09-03: the same note must LOOK the same in
  the editor, in a PDF and on a published page.** All three come out of
  `renderNoteHtml`, so this is one stylesheet's job — and sub-project P shipped
  three divergences at once by changing only `editor.css`: headings had no
  colour in the export, `th` was shaded with `--bear-surface`, and `hr` drew in
  `--bear-border`. Carried across in P's follow-up:
  - `h1`-`h6`, `li::marker` and `hr`'s `border-top` take `--bear-accent`, all
    six levels, exactly as `.ProseMirror` does.
  - `th` and `tbody tr:nth-child(even) td` take `--bear-table-header` and
    `--bear-table-stripe` — the SAME derived tokens, added to
    `EXPORT_TOKEN_NAMES` rather than re-derived. `readExportTokens` copies a
    custom property verbatim (reading one back does not resolve it), so the
    `color-mix` lands in the exported `:root` beside the `--bear-bg` and
    `--bear-text` it references and resolves there as it does in the app.
    There is no second recipe to drift, which is the same move the callout
    glyph tokens make.
  - `--bear-surface` was the header ground before this, and that is why
    `high-contrast` exported an UNSHADED header: its `bg` and `surface` are
    both the same black. Deriving from `bg` fixes it for every theme at once.
  - `html.test.ts`'s "the accent and the table shading stay parallel between
    editor and export" describe guards all four, two-sided (a divergence must
    not be fixable by changing the editor) and by VALUE rather than by
    mention. Each assertion was verified to fail against the pre-fix
    stylesheet. A fifth test asserts the export really emits a `<tbody>`,
    because `tbody tr:nth-child(even) td` is a valid rule that matches nothing
    if `DOMSerializer` ever stops wrapping rows — a table that silently lost
    its stripes with every rule comparison still green.
  - Two divergences deliberately NOT closed here, so they are not
    rediscovered as new: the export has no title-line treatment (the editor's
    `> :is(p, h1…h6):first-child` renders a note's first line large and
    accented; the export renders it as an ordinary block), and its heading
    sizes are literals (`1.6em`/`1.35em`/`1.15em`) where the editor derives
    three sizes from `--bear-heading-ratio`. Both are wider than a colour and
    were out of the follow-up's scope.


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
  renderer's browser cannot resolve ANY host — `--host-resolver-rules=MAP *
  ~NOTFOUND` at launch — so it could not fetch `files/<id>.webp` even if the
  path were absolute. Inlining is what lets that isolation stay intact while
  the image still arrives.

  **Stated precisely, because an earlier version of this bullet was not.** It
  read "a container with deliberately no route off the host (G's control 4
  reasoning)", which contradicts the control-4 bullet above: control 4 is NOT
  built, and the container does keep a real route to the internet. What is
  built is the browser-level resolver block, and that is what this bullet
  actually rests on. The two statements sat in one file for a day; a security
  property asserted in one place and denied in another is worse than either
  answer alone.

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

- **A diagram that cannot render exports as its own fence, verbatim — never a
  blank space and never a build failure.** `collectDiagramSources` walks the
  same parsed document `renderNoteBody` is about to serialize (never a raw-text
  scan, which would miss a fence indented under a blockquote); `html.ts`'s
  `replaceMermaidBlocks` swaps in a rendered SVG only when one was actually
  supplied for that exact source, and leaves the ` ```mermaid ` block as an
  ordinary code block otherwise — never asked for, still in flight, or failed
  are all the same case here. An export that refuses to run over one bad
  diagram is worse than one carrying a code block.

- **Markdown export never renders a diagram.** It is the note's text
  VERBATIM (see the rule above this section) — a Mermaid fence stays a fence,
  exactly as typed. Only HTML and PDF export call `collectDiagramSources` and
  `ensureDiagram` at all.

- **Publishing (sub-project M) is not a second rendering pipeline — it posts
  the SAME standalone HTML document HTML export already builds, unchanged.**
  `PublishDialogContainer.handlePublish` calls the caller's `buildHtml`, which
  is `renderNoteHtml` — the identical function `NoteEditor.handleExport` calls
  for the "HTML" menu item, images already inlined as `data:` URIs and all —
  and sends those bytes verbatim as the POST body. There is no separate
  "publish renderer." This is also why a client-side re-render was never on
  the table for making a published page reflect a LIVE note: the server may
  import nothing from `src/` but `src/data/types.ts` (see CLAUDE.md's
  Architecture boundaries), so it has no access to the editor pipeline that
  would be needed to render Markdown into HTML itself.

- **The server never parses Markdown, and publishing does not change that.**
  `server/src/routes/publish.ts` treats the posted body as an opaque byte
  string with a size cap (`MAX_PUBLISH_BYTES`, `readCappedBody`) — it writes
  those bytes to disk (`writePage`) and serves them back unmodified
  (`server/src/routes/publicPage.ts`). It does not parse, sanitise, or
  re-render the HTML it is handed; the only transformation the public route
  applies is wrapping the response in the CSP/`noindex`/`nosniff`/
  `no-referrer` headers documented in `docs/rulings/accessibility.md` and
  `server/README.md`'s host-split section. This is the snapshot model: a
  published page is a photograph of the note at publish time, not a live view
  of it, and it stays that way until a republish sends a new photograph.

- **The export's heading sizes DERIVE from `--bear-heading-ratio`, and the
  literals they replaced were not merely un-derived — they were wrong.** From
  M9a until sub-project Q the export shipped `h1: 1.6em`, `h2: 1.35em`,
  `h3: 1.15em`, which `tokens.css:137` names in its own comment as "the
  previous" scale. M9a replaced it with `--bear-heading-ratio: 1.2` and the
  editor's derived `1.728 / 1.44 / 1.2`; the export kept the old numbers for
  two milestones because nothing in the repo compared the two files. Q closed
  it, because a divergence nobody can see becomes visible the moment the
  reader controls the font size. Never re-literalise these. The guard is
  `html.test.ts`'s "sizes %s exactly as editor.css does", which reads the REAL
  `editor.css` through the existing `?raw` import rather than restating a
  number — so it also catches a future drift introduced from the EDITOR side,
  which a hardcoded expectation could not. It normalises whitespace and the
  padding Prettier leaves inside a wrapped `calc( … )`; that normalisation is
  comparing meaning rather than formatting, and reformatting either file to
  make a naive comparison pass would be the wrong repair.

- **The exported document gives its first block the same title treatment the
  editor gives it**, mirroring `editor.css:218` and `:238`: `ratio³`, the
  accent, weight 700, `line-height: 1.25`, `letter-spacing: -0.02em`, and the
  separator placed as `margin-top` on the FOLLOWING sibling rather than as a
  bottom margin on the title — adjacent margins collapse in a block container,
  so a bottom margin would silently lose to whichever of the two is larger.
  Specificity is `(0,1,2)` for `body > :is(p, h1…h6):first-child` against the
  heading group's `(0,0,1)` and `body > * + *`'s `(0,0,1)`, so both title rules
  win on specificity rather than on source order. This is safe only because the
  export puts nothing before the note's own first block — the note title
  appears in `<title>` and nowhere in `<body>`.

- **`--bear-heading-ratio` and `--bear-title-gap` are forwarded tokens with
  fallbacks (`1.2`, `1.75em`), like every other name in
  `EXPORT_TOKEN_NAMES`.** The existing "defines every custom property it
  references" test is what enforces the pairing: removing either name from the
  list while a rule still references it fails there, loudly, rather than
  shipping a document whose headings silently collapse to the initial value.

- **Comments in the export stylesheet are bytes, twice over.** They ship in the
  eager chunk AND in every exported file — sub-project P's first draft cost
  960 B, almost entirely CSS comments. The rules Q added carry none; their
  reasoning is the three bullets above. This is why the stylesheet already
  says its reasoning lives in this file.
