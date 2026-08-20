# Export

Governs how a note leaves the app as Markdown, HTML or PDF: which pipeline renders it, what the exported document is allowed to change, and how it gets its colours and its print behaviour.

**Trigger:** any change under `src/features/export/` — `html.ts` (`renderNoteBody`, `renderNoteHtml`, `readExportTokens`, `EXPORT_TOKEN_NAMES`, `FALLBACKS`, the inline `<style>` block), `exportNote.ts` (`exportNote`, `MIME`), `print.ts` (`printHtmlDocument`, `defaultPrint`), `filename.ts`, `ExportMenu.tsx`; `NoteEditor.handleExport` in `src/features/notes/NoteEditor.tsx`; the `export.*` keys in `src/i18n/en.ts` / `ko.ts` and the `ALLOWED_IDENTICAL` list in `i18n.test.tsx`; the export block in `e2e/notes.spec.ts`; and any new import of `marked` or `@tiptap/markdown` outside `src/features/editor/markdown.ts`.

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

- **PDF is the browser's print pipeline, into a hidden same-origin iframe.**
  Printing the app's own window would need a print stylesheet that hides three
  panes, two floating pills and a dialog, and every future piece of chrome would
  silently need adding to it. Printing a separate document means the PDF is
  exactly what `renderNoteHtml` produced. The frame is fed by `srcdoc` (not
  `document.write`) so it stays same-origin and `contentDocument` is reachable;
  it uses `visibility: hidden`, not `display: none` — a display-none frame has
  no layout in some engines and prints blank — is focused before printing
  (Safari prints the parent otherwise), waits on `fonts.ready` (a print started
  early lays out in the fallback face), and is removed in a `finally` so a
  throwing print cannot leak a whole second document per export.

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
