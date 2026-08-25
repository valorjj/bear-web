# Tables

Governs how Markdown tables are represented in the editor schema and how they are serialized back to Markdown.

**Trigger:** `src/features/editor/TableHandles.ts` (the edge-handle widgets and
their `data-shape` rebuild guard), `src/features/editor/tablePos.ts`
(`tablePosAt`), `src/features/editor/tableCommands.ts` (`TABLE_COMMANDS`, the
seven-action `COMMANDS` map),
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

- **Adds no longer have a missing "before" pair — that gap was about the bar,
  and the bar is gone.** The original reasoning was real: ten buttons on a bar
  that floats over the user's prose was a worse trade than one extra keystroke,
  so only "after" shipped, matching a behaviour the editor already had (`Tab`
  out of the last cell appends a row). Sub-project H deleted the bar in favour
  of a right-click menu and edge handles, and the reason for the gap went with
  it: the menu has no width budget to protect, so it carries both `Insert row
  above`/`Insert row below` and `Insert column before`/`Insert column after` as
  named rows (`tableCommands.ts`'s `TABLE_COMMANDS`). The edge handles need
  neither direction at all — a handle inserts adjacent to the edge it sits on,
  so which edge the user clicked already says "before" or "after" without a
  choice to make.

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

- **The widget shape was originally chosen to need NO geometry code, and edge
  handles reintroduce that geometry deliberately.** The bar rendered as one
  `Decoration.widget` anchored to the table's own position, so it could never
  drift on scroll — there was nothing to measure. `TableHandles.ts` instead
  computes a handle's position from the table's real row/column boxes, which is
  exactly the class of code the original design avoided. Consequently **no unit
  test can assert a handle's position**: jsdom has no layout engine, so a
  handle's coordinates are meaningless under Vitest. That coverage lives only
  in `e2e/editorContext.spec.ts` and `e2e/editorAffordances.spec.ts`, against a
  real browser.

- **A handle's identity must be checked against the table's full 2-D shape, not
  a scalar summary — a shape-guard defect found in review proves why.**
  `TableHandles.ts` originally decided whether to rebuild its handles by
  comparing `rows.length + columns.length` between the current and previous
  render. A 3×2 → 2×3 transpose keeps that sum at 5, so the guard saw no
  change, skipped the rebuild, and left handles whose `data-table-handle` kind
  and `data-index` no longer matched the table under them — clicking what was
  now a COLUMN handle inserted a ROW instead. This was reachable in practice,
  not merely theoretical: `prosemirror-history` groups steps within a 500ms
  window, so a single `Ctrl+Z` undoing a quick "delete a row, add a column"
  pair produces exactly that one transpose-shaped update. Fixed by comparing a
  2-D `data-shape` signature (rows and columns separately) rather than their
  sum, so any shape change — including one that preserves the total — forces a
  rebuild.
