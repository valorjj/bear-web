# Tables

Governs how Markdown tables are represented in the editor schema and how they are serialized back to Markdown.

**Trigger:** `src/features/editor/TableControls.ts` (`TABLE_ACTIONS`,
`tablePosAt`, `COMMANDS`, `TableControlsOptions.labels`),
`src/features/editor/tableMarkdown.ts` (`MarkdownTable`, `withPipeEscapingCells`), the `@tiptap/extension-table` imports and `MarkdownTable`/`TableRow`/`TableHeader`/`TableCell` entries in `src/features/editor/extensions.ts`, `RawTable` in `src/features/editor/RawBlock.ts`, `src/features/editor/table.test.ts`, and any table fixture in `markdown.test.ts`'s `CANONICAL` or `stability.test.ts`'s `NON_CANONICAL`.

- **Tables are real nodes, and the `RawTable` fallback is no longer registered.**
  M8c replaced it with `@tiptap/extension-table`, whose official node already
  ships a Markdown tokenizer, parser and serializer — which is the only reason
  this was worth doing rather than leaving tables as preserved text.
  Hand-writing a GFM serializer would have been a second Markdown
  implementation, this project's signature defect. The `RawTable` constant
  still EXISTS in `RawBlock.ts` (the factory serves four other fallbacks and it
  was left beside them), but it is absent from `editorExtensions` and must NOT
  be re-registered: it would claim the `table` token an extension above already
  handles. `table.test.ts` and `rawBlock.test.ts` both assert its absence from
  the schema and from the extension list.

- **`MarkdownTable` wraps the official node to fix two serializer defects, and
  BOTH are invisible to an idempotence-only assertion.** This is the clearest
  live instance of the round-trip suite's documented blind spot.
  - **Pipes in cell text were not escaped.** `| x \| y | z |` parses to two
    cells and serialized back to `| x | y | z |` — three cells in a two-column
    table — and normalizing THAT dropped `z`. Real data loss, and a regression
    against the old fallback, which preserved such a table byte-for-byte. The
    package exports `escapeTableCellPipes`, but only its PARSE path uses it;
    the render path emits cell text verbatim.
    **Timing is the whole trick and the obvious fix is wrong:** escaping the
    document's text nodes before rendering fails, because the text renderer runs
    afterwards and escapes the backslash, producing `x \\| y` — the same lost
    cell by a longer route. The escape wraps `renderChildren` so it applies to
    already-rendered cell Markdown. Its `(?<!\\)` lookbehind keeps it idempotent
    if the renderer ever starts escaping pipes itself.
  - **A table gained a blank line above and below itself.**
    `renderTableToMarkdown` wraps its output in newlines and `MarkdownManager`
    already joins blocks with one, so `# Shopping\n\n| item` became
    `# Shopping\n\n\n| item`. Stable, so every idempotence check passed.
    Trimming only the table's own edges (`replace(/^\n+|\n+$/g, '')`) is
    deliberately narrower than a general "collapse blank runs" pass in
    `serializeMarkdown`, which would corrupt a fenced code block containing
    blank lines.

- **A table is NORMALIZED, not preserved.** Cells are padded to the column's
  widest content and the separator row is rewritten, so a table typed unpadded
  changes shape on the user's first edit. This does not violate "opening a note
  produces no write" — that holds because `NoteEditor` seeds autosave from the
  mounted editor's own reading — but it does mean the stored text changes once,
  on the first real edit. Accepted: editable tables are worth it. Consequence
  for tests: an unpadded table belongs in `stability.test.ts`, which only
  requires a fixed point after one pass, never in `markdown.test.ts`'s
  `CANONICAL`, which requires byte-for-byte identity.

- **The alignment row is WIDER than the columns it describes, and the fidelity
  string pins that.** The serializer writes `max(3, width)` dashes and then adds
  the alignment colon outside that count, so `| left | right |` gets
  `| :---- | -----: |`. Do not "tidy" the pinned string; fidelity's job is to
  state exactly what the serializer produces, and a prettier value would be
  false.

- **Tables need STRUCTURAL assertions, in `table.test.ts`.** A real table and a
  preserved block of source produce identical Markdown, so no round-trip test
  can tell them apart — the same blind spot that let a dead `==highlight==`
  tokenizer and a live-but-banned underline mark ship in M4. That file asserts
  the schema registers the four nodes (`table`, `tableRow`, `tableHeader`,
  `tableCell`), that `rawTable` is absent, that a parsed table carries no
  `source` attribute, and that parsing yields header/body rows with
  paragraph-wrapped inline content and marks preserved inside a cell.

- **The bar's commands are `prosemirror-tables`' own, not Tiptap's wrappers.**
  A ProseMirror plugin has a `view`, and therefore a `state`/`dispatch` pair,
  but no `Editor`. Reaching for one from inside the plugin would be the editor
  learning about the layer above it — the boundary `TagPill`'s `onActivate`
  and `HeadingFold`'s `onOpenMenu` both keep by having the app pass callbacks
  down rather than the plugin reaching up.

- **Adds land AFTER the current row/column, and there is deliberately no
  "before" pair.** Ten buttons on a bar that floats over the user's prose is a
  worse trade than one extra keystroke, and "after" matches a behaviour the
  editor already had: `Tab` out of the last cell appends a row.

- **`tablePosAt` walks OUTWARD from the cursor; it does not scan the
  document.** A table nested in a blockquote or a list item must resolve to
  itself, not to an ancestor, so `$from.node(depth)` is checked from the
  deepest depth up and the innermost match wins. Pinned by a test using a
  blockquote-wrapped table.

- **The pinned strings in `tableControls.test.ts` are padded and use a
  three-dash alignment row, and that is not a typo.** Every expectation there
  is the serializer's real output, per the alignment-row bullet above. The
  caret sits in the first BODY cell throughout, which is what makes each
  expectation specific rather than merely "something changed": `deleteRow`
  takes the body row and leaves the header, and `addColumn` inserts after
  column 0 so the new column lands in the MIDDLE. A trailing blank line in
  each is `TrailingNode`'s paragraph, not the table's.
