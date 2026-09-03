# Next up

Written 2026-08-20 after M8 + M9a shipped; last reconciled against
`CLAUDE.md` on **2026-09-01**, when sub-project M (publish, a public
read-only URL for one note) shipped.

This file exists so a fresh session can resume without re-deriving decisions
already made. Delete a section once its sub-project has a real spec in
`docs/superpowers/specs/`.

**`CLAUDE.md`'s status table is the authority on what has shipped; this file is
the authority on WHY and in what order.** They drifted apart between 2026-08-21
and 2026-08-27 — a K3 heading here read "NOT STARTED" directly above its own
body announcing it shipped, M9b sat under "Cut, with a reason" after shipping,
and "the item still missing from the goal" still claimed image storage had
never been scheduled. All three are corrected below. When they disagree again,
believe the table and fix this file.

## Where things stand

- `main` carries everything in `CLAUDE.md`'s status table marked complete —
  through **L5 (server-rendered Mermaid diagrams), 2026-09-01**. Live on Pages.
- 2444 unit tests, 208 end-to-end. All six gates green.
- Every sub-project branch named in this file is merged and deleted.

**What is actually left, as of 2026-09-03:**

| Open | State |
| --- | --- |
| **N paste Markdown as Markdown** | SHIPPED 2026-09-02 — see the spec |
| **J4 platform chrome** | not started — the last of the four |
| **K4 the thumbnail** | mostly done in K1; what remains is cosmetic |
| **Dropping** Markdown text into a note | not started — N covered pasting only; `ImagePaste` handles `drop` for images, so text dropped in keeps the literal behaviour |
| `&amp;nbsp;` round-trip corruption in `markdown.ts` | not started — found while specing N. Named and numeric entities survive `parseMarkdown` as literal text and gain an `&amp;` on serialize, so a TYPED or already-stored `&nbsp;` is permanently wrong. N fixed the paste path only. Needs `CANONICAL` + `NON_CANONICAL` entries. |
| A static import-cycle check over `src/features/editor/` | not started — `importCycle.test.ts` pins the ONE order that broke the app on 2026-09-02; a check in `scripts/sourceLint.test.ts` would catch any cycle in any direction, which is strictly stronger |
| Lazy construction in `markdown.ts` | not started — its manager and schema are built at module top level, which is what makes any cycle through it fatal at initialisation. Building them lazily removes the hazard rather than pinning one instance of it. |
| A table pasted into a table cell is silently dropped | not started — found in N's final whole-branch review. Caret in cell `a` of a two-column table, paste `\| x \| y \|\n\| --- \| --- \|\n\| 7 \| 8 \|`: the result is `\| <br>a \| b \|` — `x`, `y`, `7`, `8` are gone and a stray hardBreak is left in cell `a`. Not a regression — pre-N inserted nothing there either — but N turns a reachable path into silent content loss, and the code-block guard added in the fix wave (`selection.$from.parent.type.spec.code`) does not cover a table target. Likely shape of a fix: detect a table-in-table paste and either flatten the pasted cells into the target cell or refuse the paste outright — refusing is the cheaper correct answer. |
| `decoded`'s cache in `pastedMarkdown.ts` is unbounded | not started — found in N's final whole-branch review. `src/features/editor/pastedMarkdown.ts` memoises entity decodes in a module-level `Map`, keyed by anything matching `&[a-zA-Z][a-zA-Z0-9]{1,31};`, and caches MISSES as well as hits, so a large or hostile paste containing many distinct non-entities grows it for the session's lifetime. Low severity — bounded by what a user actually pastes, and each entry is tiny — but the fix is small: don't cache `null`, or cap the map. |
| `e2e/imageResize.spec.ts`'s drag-resize persistence test fails ALONE and passes in the full suite | not started — this repo's habit is to blame e2e failures on machine load, and that habit is wrong here. The controller ran this one spec alone on a QUIET machine (load average 2.6, no contention) and it failed 2 of 3 runs on `main` and 3 of 3 on N's branch. The assertion is `expect(Math.abs(restored - after)).toBeLessThan(8)` at `e2e/imageResize.spec.ts:68`; it received **172** — a drag-resized image's width does not survive a reload, reverting by ~172px. It is a K3 (image resize) defect the full suite's noise had been hiding behind "flakes under load." The 3/3-vs-2/3 difference between branches is itself inside the noise at n=3, and N is not implicated — N touches only paste code, and a `handlePaste` plugin has no path to pointer-drag width persistence. Every characterisation attempted here has been an overclaim, and this line records the third and final one rather than re-editing the earlier two. Measured on idle machines (load 2.4-2.6): run ALONE, 3/3 fail on the feature branch and 2/3 on `main`; inside the FULL suite, it passed twice and then failed once. So it is simply INTERMITTENT, at a high enough rate to reproduce on demand — not deterministic, and not load-driven either, since every one of those runs was on a quiet machine. "Broken, not flaky" was wrong; so was "fails alone, passes in the suite". No mechanism was ever found. Whoever picks this up should reproduce with the single-spec run, expect roughly a 2-in-3 failure rate, and treat one green run as meaningless. |
| **Q typography settings** | SHIPPED 2026-09-03 — see the section below |
| The bundle ceiling is **351,000 B**, raised by the user on 2026-09-03 | Q shipped at **349,360 B**, a true eager cost of **1,505 B**, leaving **1,640 B**. Two claims this row used to make were wrong and are corrected in `scripts/bundleSize.test.ts`'s docblock with the measurements: a fourth `React.lazy` root makes the closure WORSE (+322 B), and `themes-*` is not the theme code — Rolldown's chunk names are arbitrary, the ~234 KB chunk is Tiptap/ProseMirror/React/lowlight, and splitting the real theme roster out nets about **-322 B**. The "ceiling comes down if Q lands under" condition did NOT fire: measured plus the ~3 KB practice is 352,360, higher than the ceiling already in force, so honouring it literally would have raised the number again. |
| An empty row above the header in some pasted tables | BLOCKED ON A FILE, not on analysis. The user reported it from a note titled 우리가 직접 답할 수 없는 질문들. Ruled out by measurement: our table PARSE is correct (`tableRow > tableHeader`, verified against the committed `src/features/editor/fixtures/geminiAnswer.plain.txt`), and `.bear-table-handles` is `height: 0; pointer-events: none` so the handle layer cannot occupy a row. Most likely the empty header row is in that note's own source Markdown. Ask the user to export it (⋯ → Markdown) before spending any more time reasoning. |
| Two editor/export divergences left open | Recorded during P's follow-up rather than fixed: the export has no title-line treatment, and its heading sizes are literals where the editor derives them from `--bear-heading-ratio`. Neither is visible in the four themes whose PDFs were pixel-verified; both will drift further as the editor gains typography controls, so Q should close them rather than widen them. |

### Q. Typography settings — SHIPPED 2026-09-03

Spec: `docs/superpowers/specs/2026-09-03-q-typography-settings-design.md`.
Plan: `docs/superpowers/plans/2026-09-03-q-typography-settings.md`.

From the user, out of real use: *"the content area looks cramp. I really want
to add 'setting' and line height, width, font-size. Just like bear."* Five
controls — font size, line height, line width, paragraph spacing, paragraph
indent — in a modal opened from the sidebar footer, applied live, persisted per
device, and carried into every export including the server-rendered PDF.

**Four measurements were taken before anything was decided, and three of them
changed the plan.**

1. The eager closure had **145 B** of headroom. Q needed more under any shape.
2. **Going lazier is negative here.** Converting `ThemeDialog` to `React.lazy`
   took the closure from 347,854 B to 348,176 B — four eager chunks became six,
   and the re-hoisted runtime cost 322 B more than deferring the whole dialog
   saved. The freeze's first escape hatch was therefore closed by measurement,
   not argued away.
3. **`themes-*` was a misread filename.** In that same spike the ~234 KB chunk
   came back named `notes-*` while a new 1,049 B chunk took the name
   `themes-*`. This file had called it "the obvious candidate" for a lazy
   split; the split nets about **-322 B**.
4. The export already forwarded all five typography tokens off the live
   cascade, so parity was free — but its `h1/h2/h3` were `1.6/1.35/1.15em`,
   the **pre-M9a** scale, against the editor's derived `1.728/1.44/1.2`. Not
   "literals where the editor derives", as this file had it: the WRONG
   literals, for two milestones, because nothing compared the two files.

**Two design decisions were revised while specing, and both are recorded in
the spec.** The hook is shaped like `useTheme`, not `useSetting` — typography
needs a paint-time mirror, and `useSetting` renders at its fallback until
IndexedDB answers, which for a font size is the whole note reflowing on every
launch. And Q CLOSES the two editor/export divergences rather than widening
them, because user-controlled type is exactly what would have made them
visible.

**Three defects came out of building the hook, each found by a failing test
and each measured before being characterised.** The heal fired when there was
nothing to heal, writing `DEFAULTS` into the row and re-triggering the live
query over a value the user had just chosen. The heal's read is asynchronous,
so a change landing inside its window was overwritten by the first-render
value the callback still held. And the live query's mount-time read resolves
with a distinct-but-equal object, whose reference inequality re-ran the apply
effect and rewrote the mirror with the older value — fixed with `useSetting`'s
optimistic slot, needed here for a different reason than `useSetting` needs
it. The third is stated no stronger than it was measured: transient and
self-correcting, invisible to a settle-then-assert test, and fixed mainly
because it made a test file fail 3-5 runs in 10.

**What the harness could not see, and running the app could.** At a 1280
viewport with three panes the editor pane is 656px, so the prose is capped at
608px while the 40em default already computes to 640px — **dragging Line width
rightward there does nothing**, and only the downward half of its range has any
effect. At 1800 both directions work. That is the clamp behaving correctly, and
it reframes the original report: at laptop widths "cramped" is a pane problem,
not a measure problem. Recorded in `docs/rulings/design-tokens-and-layout.md`
so nobody "fixes" the control.

**Two of this session's own assertions were wrong and were corrected rather
than left standing.** A `Number.isFinite` check in the guard was dead — the
bound comparison already rejects NaN, since every comparison against it is
false — and the test whose comment claimed to prove it passed with the check
deleted. A regression test written for the mirror race passed 8/8 against the
unfixed hook and was deleted for being vacuous. And an e2e comment claiming to
test NaN through the pre-paint path was wrong in a subtler way: that path is
`JSON.parse`, which has no NaN literal, so the reachable non-finite value is
`1e999`.

**Shipped at 349,360 B**, +1,505 B, with `measure:check` passing unchanged —
which is the assertion that the reading preference stayed in the prose and out
of the chrome.

### N. Paste Markdown as Markdown — SHIPPED 2026-09-02

Spec: `docs/superpowers/specs/2026-09-02-n-paste-markdown-design.md`. Plan:
`docs/superpowers/plans/2026-09-02-n-paste-markdown.md`. Ledger:
`.superpowers/sdd/2026-09-02-n-paste-markdown/progress.md`.

Reported from real use on 2026-09-01: pasting raw Markdown inserted it
literally — `**bold**` stayed asterisks, a `|---|---|` table became one
paragraph per row, and a paste from a rich web source left `&gt;` and `&nbsp;`
sitting in the text. `MarkdownPaste`, a `handlePaste` extension, closes this:
`text/plain` runs through the same `parseMarkdown` every note already loads
through, and its nodes replace the pasted characters.

**Four decisions, all recorded with their reasoning in the spec:**

1. Every `text/plain` paste is parsed as Markdown, with no heuristic gate —
   the boundary a conservative trigger would draw is invisible to the user,
   and is worse than being occasionally wrong.
2. `text/html` wins whenever `htmlCarriesStructure` finds structure in it
   (`h1-h6`, lists, tables, `pre`, `code`, `blockquote`, `img`, `a`,
   emphasis…), because it is the source's own considered rendering and the
   plain flavour is a lossy serialisation of it; the plain flavour is parsed
   as Markdown only when there is no HTML, or the HTML is wrappers-only.
   `<a>` counts as structure, so a copied paragraph keeps its link.
   **This reverses the rule as first shipped**, which preferred the plain
   flavour whenever `looksLikeMarkdown` said it looked like Markdown, and gave
   HTML no say beyond that. Reversed 2026-09-03, by the user, after real use:
   a Gemini answer's plain flavour fenced the whole document and a NESTED
   fence closed the outer one early (fences on lines 5, 63, 69 and 93),
   producing 2 code blocks with an ASCII diagram stranded between them, while
   the same clipboard's HTML said "one code block". `htmlCarriesStructure`
   replaces `looksLikeMarkdown`, which is deleted along with its 28 tests. See
   the spec.
3. Entities the parser leaves literal (`&nbsp;`, `&mdash;`, numeric
   references) are decoded on the paste path only, by `decodeEntities`, which
   skips exactly the four entities `parseMarkdown` already decodes itself
   (`&amp;` `&lt;` `&gt;` `&quot;`, case-sensitively) to avoid a double-decode.
4. No escape hatch ships. `⌘Z` reverses a paste in one step; a "paste as plain
   text" command was considered and rejected.

**The literal `&gt;`/`&nbsp;` symptom from the original report was the SAME
defect as the missing parse, not a second one** — both are "the paste path
never reaches `parseMarkdown`'s decoding," and fixing the one fixes the other.
No separate entity-handling code was needed on the paste path beyond
`decodeEntities`'s narrow four-entity skip-list.

**What the build corrected that the plan did not anticipate:** a circular
import (`extensions.ts -> MarkdownPaste.ts -> markdown.ts -> extensions.ts`)
stopped the app booting outright, passed all six gates, and was caught only
by running the app — see `docs/rulings/markdown-and-schema.md` and
`CLAUDE.md`'s toolchain-surprises entry on module-initialisation cycles. Four
residue items came out of specing and building N and are tracked in the table
above rather than here: dropping Markdown text (not just pasting it),
`markdown.ts`'s own `&amp;nbsp;` round-trip corruption on typed/stored notes,
a repo-wide static import-cycle check, and making `markdown.ts`'s module-level
construction lazy to remove the cycle hazard rather than merely pin one
instance of it.

### The L-series, and why in this order

Decided 2026-08-31 from a triage of nine candidate features the user proposed.
The full write-up is an artifact:
<https://claude.ai/code/artifact/840b86c9-3303-4415-91a6-bd4f9ed28992>

The organising principle, which predicted cost better than anything else: a
feature that is a **projection of data the app already holds** is cheap and
compounds; a feature that adds a **new runtime or a second authoring surface**
is a whole product. Backlinks (L2) was the first kind, which is why it was
first. So is L3.

- **L3, the graph — SHIPPED 2026-08-31.** A rendering of `noteLinks`, not a new
  system; see its own section below for what shipped and what the build
  corrected. It delivers most of what a "mind map" would, without a second
  editor to sync, export and round-trip.
- **L4, the command palette — SHIPPED 2026-08-31.** Not on the user's list,
  added because it is the strongest "built for developers" signal and it
  makes everything else discoverable. It was assembly, not invention:
  `useScopeShortcuts.ts` owns the app-level `⌘K` key, `Dialog.tsx` traps
  focus, `matchCommands.ts` ranks. See its own section below.
- **L5, Mermaid — SHIPPED 2026-09-01, server-rendered as planned.** Spiked on
  a throwaway branch on 2026-08-31 and fully reverted before the real build:
  lazy-loading a client-side Mermaid worked cleanly, but **one simple
  flowchart cost 208 KB gzipped across 27 requests**, against a whole-app
  bundle of ~334 KB — 62% of the application for one diagram. All diagram
  types together were 947 KB across 94 chunks, so eager was disqualified
  outright, and 111 packages / 84 MB would have landed in `node_modules`. The
  way out existed only because G and K2 were already built: render to SVG in
  the **containerised Chromium already used for PDF export**, cache it
  content-hashed like an image, and the reader pays a few KB. See its own
  section below for what shipped and what the build corrected.

**Cut, with reasons, so they are not re-proposed:**

- **A terminal for running code.** The Mac Mini is reachable through a
  Cloudflare tunnel and the rate limiter trusts `cf-connecting-ip` verbatim
  because the tunnel is assumed to be the only door. Code execution turns a
  notes backend into a remote-execution service on a personal machine beside
  real files. Not "later" — no.
- **A spreadsheet with a Python kernel.** Two products, neither of them
  note-taking, and it inherits the row above. M8c already ships real tables.
- **YouTube/Google embeds.** Low value in a developer's notes and each is a
  third-party iframe. The only narrow version worth considering is unfurling a
  GitHub issue or PR title server-side, cached.
- **A standalone mind-map editor** — superseded by L3, per the reasoning above.

**The image asks were already shipped.** K1-K3 downscale to 2048px WebP q80
before upload, the server caps one image at 5 MB and an account at 2 GB, so a
pasted screenshot lands at a few hundred KB and a 3 MB cap would never bind.
What was missing was visibility, and L1 added it.

**Mobile is nearly done.** J1 turned "unusable" into "usable", J2a fixed the
phone header's proportions, J2 made every affordance reachable by a finger, and
J3 fixed the editor's layout — the keyboard, the toolbar and tables that
scroll. Only J4 is left, and it is the smallest of the four: safe-area insets
throughout, `100dvh` on the shell, installability, pull-to-refresh, and whether
an installed PWA changes J1's answer on routing.

**Nothing blocks anything now that L3 has shipped.** K4 is small enough to
slot in anywhere.

**J4 inherits two things by name.** J1 carved out one safe-area exception and
only one — the note list's FAB — so every other bottom-anchored surface still
needs it, the editor's now-taller formatting toolbar included. And J3 moved
three menu clamps to `100dvh` but deliberately left the app SHELL's own height
alone; that is J4's.

### E. Editor affordances — **SHIPPED 2026-08-24**

Heading level glyphs replacing the fold badge's digit, four named highlight
colours, and a floating add/delete bar for tables. No spec: three bounded
changes, designed in chat and approved before implementation.

Two findings worth carrying forward:

- **A coloured highlight serializes as `<mark class="hl-blue">`, and the
  mark's tokenizer has to claim that form itself.** Left to marked's
  inline-HTML handling the tag was taken but its contents passed through as
  literal text, so a coloured highlight over bold text came back as a literal
  `\*\*bold\*\*` — which is what the app writes the moment a user colours a
  bold run. A byte-for-byte fixture cannot see this; only a structural
  assertion can.
- **Chromium's refusal to focus inside a heading widget does NOT generalise.**
  A button inside the table bar's `Decoration.widget` focuses normally, so
  that bar needs no keyboard escape hatch while B1's fold gutter needed
  `Mod-Alt-F`. Measured, and pinned by `e2e/editorAffordances.spec.ts`.

### F. Theme system — **SHIPPED 2026-08-24**

Spec: `docs/superpowers/specs/2026-08-24-f-theme-system-design.md`.
Plan: `docs/superpowers/plans/2026-08-24-f-theme-system.md`.
Rulings: `docs/rulings/design-tokens-and-layout.md`, `accessibility.md`.

Sixteen themes, derived defaults so a new one costs eight values instead of
twenty-six, and a modal card-grid picker built on a new `src/ui/Dialog.tsx`.

Four things diverged from the spec or were only found by building it:

- **The spec's central claim was wrong and was corrected mid-flight.**
  `muted`/`faint`/`border` are not `text` mixed toward `bg`: their lightness
  fits, their chroma does not, and no single ratio reproduces the shipped
  themes. Derivation provides DEFAULTS for new themes; the old five keep
  every hand-tuned value.
- **The derivation was dead on first implementation**, because the default
  palette sat in `:root` and a literal there applies to every theme that does
  not override it. Found with a probe theme, not by a test — all of them
  passed.
- **`parseColour` was silently blind to `color(srgb …)`**, and `NaN < min` is
  false, so the contrast harness would have passed every derived theme.
- **Nine of the eleven new themes needed a value moved to clear a contrast
  floor**, in both directions. Solarized fails at both ends of its own range.

Still open, and deliberately not F: a custom-theme editor (letting a user
supply their own eight colours), and per-theme syntax palettes, which **C
will need** — that is why C is queued after F rather than before it.

### G. PDF export — SHIPPED 2026-08-25

Spec: `docs/superpowers/specs/2026-08-25-g-pdf-export-design.md`.
Plan: `docs/superpowers/plans/2026-08-25-g-pdf-export.md`.
Rulings touched: `docs/rulings/export.md` (the "PDF is the browser's print
pipeline" bullet is gone, replaced by six) and `docs/rulings/accessibility.md`
(the `aria-disabled` menu item, and why Playwright cannot click one).

Eight tasks. PDF export left the browser: `src/features/export/print.ts` is
deleted, `requestPdf` POSTs the document `renderNoteHtml` already builds to an
authenticated `POST /export/pdf`, and a separate Chromium container
(`server/pdf/`, `markflowing-pdf`) renders it. **The reason was fidelity, not
capability** — the print dialog let the user produce a document the app did not
design, and the reference app's PDF export ignores the selected theme
entirely. A Nord export is now a genuinely dark PDF, proven from the bytes.

**Findings worth carrying forward:**

- **The two options the whole claim rests on had no test for four tasks.**
  `emulateMedia({ media: 'screen' })` and `preferCSSPageSize: true` are
  invisible to a `%PDF-` prefix check, a byte length, and a text extraction —
  flip either and all three still pass. They are now pinned twice, by
  `server/pdf/fidelity.test.ts` (a probe document whose page size, page colour
  and text indent each differ between the two media) and by
  `e2e/pdfExport.spec.ts` (a real Nord export, from the real container).
  Both were verified by fault injection, four separate injections.
- **A PDF content stream is in CSS pixels from the page content box; the
  MediaBox is in points.** Recorded in `CLAUDE.md`. The first version of the
  page-background check compared the two and reported a dark export as
  luminance 0.86, matching a rectangle painted in a glyph's own space.
- **Control 4 was never built and the spec now says so in place.** The
  container keeps a route to the internet that the browser inside it cannot
  use. `internal: true` denies egress AND kills the published port, while the
  container healthcheck goes on reporting `healthy`. Closing it properly needs
  the API and the renderer on one internal network, or a unix socket instead
  of TCP.

**Known debt from G, none of it blocking:**

- **RESOLVED 2026-08-25: the `@page` margin is now 0, and the 18mm/16mm inset
  moved onto `body`'s own padding.** The unpainted margin band (measured: A4's
  MediaBox 793 x 1123 px, theme background only 673 x 986 — the content box)
  meant a dark export was a dark block on white paper, most visible in `nord`
  and `high-contrast`. Decision: paint the sheet, not preserve the border —
  `@page { margin: 0 }` plus equivalent `body` padding puts the inset inside
  the painted box instead of outside it, so text keeps its distance from the
  edge without leaving any paper colour showing. Verified visually against
  `npm run shots:pdf`'s `nord` raster: dark edge to edge, no white band.
- **The container-backed test runs only by hand.** CI has no renderer — the
  image is 3.92 GB — so `e2e/pdfExport.spec.ts`'s deepest test skips there.
  Deliberately NOT mirrored on `migrate.test.ts`'s "assert the env var under
  CI", which would simply turn `main` red. What CI does run unconditionally is
  the fidelity suite and the print-media guard; the command for the rest is in
  `server/README.md`.
- **`readCappedBody`'s cap and the renderer's own `MAX_BYTES` are both
  2 MiB and are declared independently** in `server/src/routes/export.ts` and
  `server/pdf/server.ts`. Nothing keeps them in step.

**The follow-up G points at is a FORMAT ROSTER, not more PDF.** The renderer
is a general document service now, and the formats it could add with no new
architecture are DOCX (via a converter in the same container), plain-text and
RTF (client-side, no server at all), an EPUB of a whole tag, and a multi-note
PDF — a tag or a smart list as one paginated document, which is the only one
of the four that needs a new endpoint shape. Unspecced, unscheduled, and it
does not block image storage.

### H. Editor interaction surfaces — SHIPPED 2026-08-25

Spec: `docs/superpowers/specs/2026-08-25-h-editor-interaction-surfaces-design.md`.
Plan: `docs/superpowers/plans/2026-08-25-h-editor-interaction-surfaces.md`.
Rulings touched: `docs/rulings/tables.md`, `docs/rulings/accessibility.md`.

Eleven tasks: a live-state selector fixing the bottom toolbar's stale pressed
states, a highlight colour palette that floats at the caret instead of living
only in the bottom toolbar, a right-click (and `Shift+F10`) editing menu, and
edge handles on table rows/columns replacing the floating table bar E shipped.

Findings worth carrying forward:

- **`useEditor` does not re-render on transactions in Tiptap v3**
  (`shouldRerenderOnTransaction` defaults to `false`); `editor.isActive()`
  called during a React render reads stale state. Fixed by reading through
  `editorState.ts`'s `useEditorState` selector, never `isActive` in a render
  body. The obvious falsification (revert one `aria-pressed` back to
  `isActive`) does NOT work — `flags` is one shared object, so the flag
  flipping still re-renders and the reverted read still sees fresh state. The
  falsifying change is removing the `useEditorState` subscription itself.
- **A `menuitemradio` group must be able to represent every one of its
  options.** The context menu's heading row initially read `EditorFlags`'s
  toolbar-shaped `heading1` alone, so five of six heading levels could never
  show as checked — visible to sighted users too, since `aria-checked` drives
  the row's own highlight colour. Fixed by adding `headingLevel: number | null`
  alongside the pre-existing `heading1`.
- **A widget's shape was chosen specifically to avoid geometry code, and edge
  handles reintroduce it deliberately** — so no unit test can assert a
  handle's position; that coverage lives only in `e2e/editorContext.spec.ts`
  and `e2e/editorAffordances.spec.ts`.
- **A shape-guard defect the reviewer caught: comparing `rows.length +
  columns.length` cannot detect a transpose.** A 3×2 → 2×3 change (reachable
  via one grouped `Ctrl+Z` over "delete row, add column", since
  `prosemirror-history` groups steps within 500ms) kept the sum constant and
  left handles whose kind/index no longer matched their position — a column
  handle that inserted a row. Fixed with a 2-D `data-shape` signature.
- **Moving the selection to the right-clicked position on menu open, instead
  of per-command, fixed a stale-context bug but nearly introduced a new
  collision:** the floating highlight palette derives from the selection too,
  so right-clicking highlighted text popped the palette on top of the menu
  until it was gated on `contextMenu === null`.
- **Three near-vacuous test assertions were found and replaced in this plan**
  (`toHaveProperty('pos')`, an `aria-expanded`-only submenu check, and
  `toBeVisible()` against an opacity-only reveal rule) — see the CLAUDE.md
  toolchain-surprises entry.

**G (PDF export) is next, and was deliberately held until H shipped.** The
user's stated motivation: Bear's own PDF export ignores the selected theme, and
closing that gap is the point of G — a note exported under a dark theme should
not print near-white text on white paper. G's spec
(`docs/superpowers/specs/2026-08-25-g-pdf-export-design.md`) already makes the
theme authoritative for the printed document, and its test plan renders the
fixed corpus note to PDF in four themes spanning the roster's light/dark
groups.

## The three sub-projects, in order

Chosen from four Bear screenshots the user supplied. All three are
**architectural** — each gets its own spec, plan, and implementation cycle.
Order was A → B → C; **A and B have both shipped**, and the reasoning below
matters more than the order:

### A. Note-list header — **SHIPPED 2026-08-21**

Spec: `docs/superpowers/specs/2026-08-21-a-note-list-header-design.md`.
Plan: `docs/superpowers/plans/2026-08-21-a-note-list-header.md`.
Rulings: `docs/rulings/scopes-and-search.md`, `markdown-and-schema.md`,
`accessibility.md`, and the struck note-list-header item in `deferred.md`.

What landed: a chevron button naming the scope, opening a flat menu with a note
count, three sort fields plus a direction toggle, three preview densities, a
hide-sub-tag-notes filter, and all seven builtin scopes with shortcuts. Sort and
preview persist globally. This closed the "note list has no header naming the
current scope" deferral open since M3.

Five things diverged from this file's original sketch or were only learned by
building it, each worth carrying forward rather than rediscovering:

- **The shortcuts are `⇧⌘1`–`⇧⌘6` and `⇧⌘0`, NOT Bear's `⌥⌘` family.** B1
  shipped heading levels on `@tiptap/extension-heading`'s
  `` `Mod-Alt-${level}` ``, so `⌥⌘1` with the editor focused would make an H1
  and switch scope at once. `Ctrl`+digit is free in Tiptap and rejected anyway
  — it switches browser tabs off macOS, and this ships to Pages. Bear's digits
  are kept; only the modifier differs. **`⇧⌘7/8/9` are unavailable** (ordered
  list, bullet list, blockquote), so a future Archive list cannot take Bear's
  `⇧⌘9`.
- **The digits follow `SMART_LIST_IDS`, not Bear.** Bear orders 잠긴항목 before
  고정됨; our sidebar has always run pinned before locked, and a digit
  disagreeing with the row above it is worse than one disagreeing with another
  app. Positions 1–4 and 0 match Bear regardless.
- **The scope list DID belong in the menu.** This file left that undecided on
  the grounds that our always-visible sidebar might make it redundant. It is
  redundant, and it stays: the menu is where the shortcut hints live, and a
  shortcut nobody can discover is a shortcut nobody uses.
- **The menu is flat, not nested.** Bear nests 정렬 and 미리 보기 스타일.
  Nesting costs hover-intent timing, a second placement layer and focus return
  on close, none of it unit-testable because jsdom has no layout engine to
  place a submenu against — for a menu that is sixteen rows flat.
- **`useSetting` needed an optimistic value after all**, which the spec did not
  anticipate. Two menu clicks in quick succession each derived from the
  rendered value, so choosing "Title" then flipping "Newest first" silently
  discarded the field just chosen. Same fire-and-forget window `usePaneWidths`
  documents.

Cut from Bear's menu, with reasons: bulk 메모 내보내기 (per-note export shipped
in M8b; scope-wide export needs its own filename and archive story), 첨부 파일
숨기기 (no attachments until image storage is scheduled), and collapsing search
behind a magnifier (churns `SearchField` coverage for nothing A needed).

### B. Collapsible headings + level badge — **SHIPPED 2026-08-21**

Spec: `docs/superpowers/specs/2026-08-20-b1-collapsible-headings-design.md`.
Plan: `docs/superpowers/plans/2026-08-20-b1-collapsible-headings.md`.
Rulings: `docs/rulings/markdown-and-schema.md`, `design-tokens-and-layout.md`,
`accessibility.md`.

Shipped as **B1**, deliberately split from **B2** (drag-to-reorder, still
queued). What landed: a hover gutter chevron folding a section, a `≡N` badge
opening 머리말 1–6 with fold / collapse-all / expand-all, folds persisting per
note across switches and reloads, and a delete-key guard at the fold boundary.

Four things diverged from this file's original sketch, each for a reason worth
carrying forward rather than rediscovering:

- **The shortcuts are `⌘⌥1`–`⌘⌥6`, not `⌘1`–`⌘6`.** Browsers own `Cmd-1`..`9`
  for tab switching and a page cannot `preventDefault` it. The `⌘⌥` family
  already existed in `@tiptap/extension-heading`; the menu only surfaced it.
- **Fold toggle is `⌘⌥F`, a genuinely new binding.** `⌘⌥0` was tried and
  rejected — it is `@tiptap/extension-paragraph`'s `setParagraph`, and Tiptap's
  reversed extension order means a later extension silently wins. Verify any
  new binding against `node_modules/@tiptap`, not just against browser
  shortcuts.
- **The gutter is reserved, not overlaid.** This file said the badge sits
  "outside the measure"; it does above a 688px pane, but below that the column
  clamps rather than letting the control overflow, because `EditorContent`'s
  `overflow-auto` clips left-side overflow entirely.
- **The gutter controls are mouse-only.** Chromium refuses `.focus()` to every
  descendant of a heading containing a ProseMirror widget — measured across
  seven experiments. `⌘⌥F` is the keyboard and screen-reader route.

### I. Note-list row redesign + row context menu — SHIPPED 2026-08-26

The row became title → preview → thumbnail → a footer line carrying the pin and
the date, which is where the date moved to (it used to sit between the title and
the preview). `deriveSnippet` joins the body lines rather than returning the
first alone, so the two reserved preview lines are actually filled.

**Findings worth carrying forward:**

- **The row draws a thumbnail, and at the time the app stored no images**, so it
  was the first remote image URL in the note's own Markdown
  (`src/features/notes/thumbnail.ts`) — which meant the list showed a picture
  the editor still showed as raw monospace text. K1 closed that by rewiring it
  to stored images, pulled forward from K4 because it turned out to be a privacy
  hole rather than a cosmetic gap.
- **A right-click does NOT select the row**, so every action is addressed by the
  request's `noteId` rather than by the selection. J2's long-press inherited
  this unchanged.
- **The row menu is what let the resting pin go.** An unpinned row's pin became
  hover-revealed because hover was no longer the only route to pinning — a
  decision J2 then had to revisit for touch, where the menu's route is a long
  press and therefore invisible.
- **Two extractions came out of it:** `src/lib/useAnchoredMenu.ts` (placement,
  focus, dismissal and the Tab trap, which `HeadingMenu`, `EditorContextMenu`
  and `TableHandleMenu` each held a byte-identical copy of) and `useExportRunner`
  in `src/features/export/`.
- **A component defined inside a render body is a new type every render.**
  `NoteRowMenu`'s `Item` was written there first, and this menu re-renders while
  open (the PDF item's `pending` flag flips mid-export), which threw keyboard
  focus out of the menu at the moment the user was reading it.

### M9b. Callout blocks — SHIPPED 2026-08-27

Spec: `docs/superpowers/specs/2026-08-27-m9b-callout-blocks-design.md`.

Five types written as `> [!warning] Title` — the microsyntax GitHub and Obsidian
core both render natively, chosen over the plugin's ` ```ad-warning ` form
because that one degrades to a code block full of the user's prose in any reader
that does not know it.

**Findings worth carrying forward:**

- **A callout is an ATTRIBUTE on `blockquote`, not a new node.** It is still a
  blockquote, so the toolbar button, `Mod+Shift+B` and nesting all keep working.
- **It opened with a corruption fix rather than a feature.** `> [!NOTE]`
  serialized to `> \[!NOTE\]`, so merely opening and saving a note carrying a
  GitHub alert rewrote it — and nothing in the suite could see it.
- **Callouts deliberately do NOT collapse.** B1's "no blockquote folding" was
  reopened in the brainstorm and upheld.

### B2. Drag-to-reorder headings — **SHIPPED 2026-08-29**

Spec: `docs/superpowers/specs/2026-08-29-b2-drag-to-reorder-headings-design.md`.
Plan: `docs/superpowers/plans/2026-08-29-b2-drag-to-reorder-headings.md`.
Ledger: `.superpowers/sdd/2026-08-29-b2-drag-to-reorder-headings/progress.md`.
Rulings: `docs/rulings/markdown-and-schema.md` (the new keybinding),
`docs/rulings/accessibility.md` (the Section group as the only keyboard
route), `docs/rulings/design-tokens-and-layout.md` (the drop indicator),
`docs/rulings/testing-and-tooling.md` (the jsdom pointer split),
`docs/rulings/deferred.md` (the pre-existing `ContextMenu.ts` staleness B2
raises the stakes on).

Grab the badge to move a heading and its whole subtree, with a drop indicator —
plus a Section group in the right-click editor menu and `Mod-Alt-ArrowUp/Down`,
because the gutter can never be keyboard-reachable. Shipped as six tasks: the
pure move/fold-remap math, the commands and keybinding, the context-menu
route, the pointer drag itself, Playwright-only coverage for the parts jsdom
cannot see, and this documentation pass.

**What diverged from the plan, and why — this is the part worth reading.**

- **The undo problem the plan didn't see coming.** Task 2's brief asked for
  "one undo step" per move and sketched satisfying it with transaction meta
  alone. That cannot work: `prosemirror-history` replays UNDO/REDO as
  inverted STEPS and carries none of a plugin's meta forward, so meta-only
  coordination can never restore a fold set on undo. The implementer added a
  past/future snapshot stack to `FoldState` instead — not in the plan, and it
  became the whole focus of that task's review. The plan's Step 3 was wrong,
  not the deviation from it.
- **The zero-step-transaction hazard the first fix introduced.** Once
  snapshots existed, a fold TOGGLE dispatches a transaction with zero steps —
  `prosemirror-history` never records it — but the first version of the fix
  pushed a snapshot for it anyway, tagged with the CURRENT document. Undoing
  a later, unrelated typing edit could then land on a document that happened
  to `eq` that snapshot and silently drop the fold — regressing B1's shipped
  "a fold is durable across ordinary editing." The fix: snapshot only when
  `tr.docChanged`, and cap both stacks at 100 entries
  (`MAX_FOLD_HISTORY`, mirroring `prosemirror-history`'s own default `depth`
  so an orphaned snapshot cannot accumulate forever).
- **A claimed crash mode was tested and found false, mid-branch.** Task 4's
  review asserted that a stale `dropAt` past `doc.content.size` makes
  `DecorationSet.create` throw an uncaught `RangeError` — plausible enough
  that it landed as a code comment. A later re-review disproved it directly:
  monkey-patching `coordsAtPos` to force the exact condition claimed, then
  shrinking the document, threw nothing on any run; the widget silently
  disappears instead (`prosemirror-view`'s `domFromPos` clamps backward for
  `side <= 0`, and the `RangeError` in that file is only on the
  selection-anchoring path). The fix that abandons a drag on a document
  change still stands — on its other, independently valid rationale: a drop
  measured against boundaries from a document that no longer exists is wrong
  regardless of whether it also crashes. `HeadingFold.ts`'s comment was
  corrected in Task 6 rather than in another fix round.
- **jsdom's pointer support turned out to split, not to be absent.** The spec
  assumed jsdom's missing `setPointerCapture` made the whole gesture
  Playwright-only. Measured 2026-08-29: jsdom DOES have a real `PointerEvent`
  constructor, so the drag's STATE MACHINE (press vs. click, the drag
  threshold, touch never dragging, Escape aborting) is unit-testable; only
  the GEOMETRY (`measureBoundaries`, distance-to-boundary) needs a real
  browser. Task 4 took the cheap coverage; Task 5 took the rest.
- **Two plan-sketch defects, caught before they cost a round.** A test
  scaffold in the plan reused a plugin key across two `Editor` instances in
  one test file, which throws `RangeError: Adding different instances of a
  keyed plugin` — the fix registers a fresh key per test. And the plan's
  `section:` flag expression for the context-menu group had two redundant
  disjuncts that, simplified naively, would have hidden the group entirely in
  a note with exactly one section — caught by the task's own review with a
  throwaway test before it shipped.

**Left deliberately unresolved, and why:** `ContextMenu.ts`'s pre-existing
keyboard-selection staleness (see `docs/rulings/deferred.md`) can now hide the
whole Section group, not just show a stale toggle. Fixing it is a change to
`ContextMenu`'s keyboard-selection handling with its own test surface —
outside a documentation task, and outside B2's stated scope.

### L2. Backlinks — **SHIPPED 2026-08-31**

Spec: `docs/superpowers/specs/2026-08-31-l2-backlinks-design.md`.
Ledger: `.superpowers/sdd/2026-08-31-l2-backlinks/progress.md`.
Rulings: `docs/rulings/tag-grammar.md` (the shared masker, and the working
NUL-byte check), `docs/rulings/notes-lifecycle.md` (a second derived index on
`reindexNote`, and the backup-restore gap), `docs/rulings/tag-pills.md` (the
link pill's activation contract), `docs/rulings/markdown-and-schema.md` (the
`TrailingNode` hazard), `docs/rulings/testing-and-tooling.md` (two grep false
negatives), `docs/rulings/deferred.md` (five items, listed there).

`[[Note title]]` links a note to another by title, fails open (a link to a
title with no matching note is inert, not an error), and both directions —
the pill's `Mod`-click and a "Linked from" panel beneath the editor — are
built on one derived index, `noteLinks`, following `noteTags`'s existing
shape and rebuild discipline exactly. Shipped as seven tasks: share the code
masker, add the link grammar, derive and rebuild the index, the pill and its
activation, the backlinks panel, `[[` autocomplete, and this documentation
pass.

**What diverged from the plan, and why:**

- **A "pure move" is only safe when it is proven byte-verbatim, and the first
  attempt was not.** Task 1 moved the masker (`maskCode`, `maskInlineCode`,
  `MASK`) into `src/data/markdown/mask.ts` for both parsers to share, and its
  own review caught two mutations that a passing test suite could not:
  `closesFence`'s doubled-backslash escape (`[ \\t]*$`, a two-character
  escape for a literal backslash-t) had been retyped as a single backslash,
  which template-literal parsing turns into an actual TAB BYTE in the regex
  source — behaviourally identical today, but only by accident, since nothing
  about "the fence's trailing whitespace" changes if a tab appears in the
  input either way. Three em dashes in moved comments had also become `--`.
  Both are the failure mode a "pure move" mandate exists to catch: a silent,
  equivalent-today change that is not actually equivalent, discovered by
  diffing `.source` strings byte-by-byte against `git show`, not by running
  the tests (which stayed 170/170 green throughout, before and after the
  bug).
- **The derivation path had two gaps the plan's file list did not name,
  because the plan named only the repository.** `reindexNote` — the single
  function meant to be the only producer of a note's derived rows — has four
  call sites, and Task 3 found the sync engine's apply path
  (`src/data/sync/engine.ts`) was not among the ones the plan called out
  explicitly; missing it would have meant a note arriving from another
  device got tag rows and no link rows, so backlinks would be silently
  incomplete on exactly the second device — the hardest kind of gap to
  reproduce, because the OTHER device would show correct backlinks. Separately,
  the controller found `backup.ts`'s restore path rebuilt the tag index but
  not the link index — same shape of gap, one table over, in a path later
  confirmed to have no UI caller today (a latent defect in unreachable public
  API, not a live one, a correction the controller made to its own earlier,
  overstated severity). Both fixed with one call each to the existing
  rebuild function.
- **The most valuable thing this sub-project found: a meta-only transaction
  can silently corrupt a note, and StarterKit's own extension is why.**
  `TrailingNode`'s `appendTransaction` runs on EVERY dispatched transaction,
  not only ones that changed the document, so `LinkPill`'s
  `setKnownNoteTitles` — a transaction whose only content is a `setMeta`
  call, fired from `RichEditor`'s mount effect — inserted a spurious trailing
  paragraph into any note ending in a list or table, with no user edit at
  all, which autosave then persisted. The fix is
  `.setMeta(skipTrailingNodeMeta, true)` on every meta-only dispatch; see
  `docs/rulings/markdown-and-schema.md` for the full mechanism and the two
  other call sites (`LinkAutocomplete`'s `move`/`dismiss`) that needed it too.
- **The vacuous-test episode: the first regression test for that exact bug
  passed with the fix removed.** `TrailingNode`'s vulnerability flag is
  computed once at plugin `init` and burned permanently by the FIRST
  untagged transaction dispatched afterward — including one a test uses only
  to set up its own fixture. Task 6's first trailing-node test typed `[[de`
  to open the autocomplete menu as setup, an ordinary untagged transaction,
  which consumed the vulnerability before the code under test ever ran; the
  test then asserted the document was unchanged and passed whether or not
  `skipTrailingNodeMeta` was present. The implementer caught this by
  distrusting a suspiciously easy green rather than accepting it, and rebuilt
  the fixture around a `quietlySelect` helper that reaches the dispatch under
  test using only tagged transactions from the very first one. A scoped
  re-review then verified the mechanism at the dependency's own compiled
  source rather than accepting the plausible-sounding story.

### L3. Relationship graph — **SHIPPED 2026-08-31**

Spec: `docs/superpowers/specs/2026-08-31-l3-relationship-graph-design.md`.
Ledger: `.superpowers/sdd/2026-08-31-l3-relationship-graph/progress.md`.
Rulings: `docs/rulings/notes-lifecycle.md` (the graph is a snapshot, not a
`useLiveQuery` subscription), `docs/rulings/testing-and-tooling.md` (jsdom has
no `Worker`; `setPointerCapture` on `pointerdown` retargets the native
`click`; a required behaviour with no test naming it can ship anyway).

A force-directed rendering of L2's `noteLinks` index — nodes are notes,
edges are wikilinks, degree drives node size, pan/zoom over an SVG canvas,
capped at `NODE_CAP = 2000` by best-connected-note truncation above that.
Shipped as ten build tasks plus this documentation pass.

**Two things worth carrying forward:**

- **The measured settle table**, from `src/features/graph/runLayout.ts`,
  median of 5 runs at the fixed `LAYOUT_TICKS = 300`, in Node (a floor — the
  browser's ticks compete with paint): 200 nodes 121 ms, 300 nodes 202 ms,
  **400 nodes 262 ms**, 500 nodes 339 ms, 800 nodes 581 ms. 400 is the last
  size that stays inside the ~250-300 ms a user reads as instant rather than
  stalled, which is why `WORKER_THRESHOLD = 400` moves the simulation off the
  main thread above that point.
- **The `React.lazy` boundary around the whole graph feature is structural,
  not an optimisation to revisit later.** `d3-force` (~5.6 KB gzip) does not
  fit the remaining main-chunk headroom: converting the import to eager was
  measured at 346,435 B against the bundle guard's 340,000 B ceiling.
  Headroom after L3 shipped is 1,884 B (main moved 337,259 → 338,116 B
  gzipped) — see `CLAUDE.md`'s Toolchain surprises.

**What the build corrected on its own way in:**

- **The spec's determinism claim was wrong, and measured wrong.** It credited
  `simulation.randomSource(seededLcg)` with making the layout stable enough to
  screenshot. Deleting the `randomSource` call leaves every test passing, and
  changing `SEED` leaves every test passing too — `jiggle()`, `d3-force`'s
  only consumer of randomness, fires only on an exact node coincidence that
  phyllotaxis initial placement never produces for a `buildGraph` output.
  Determinism actually comes from phyllotaxis placement plus the fixed
  `LAYOUT_TICKS`; what protects the shots is the committed golden-fingerprint
  test in `layoutGraph.test.ts`. `randomSource` is kept as cheap insurance
  against the coincident-node path, not removed.
- **Two real product bugs passed the whole unit suite and were caught only by
  Playwright.** Every node click did nothing in a real browser because
  `setPointerCapture` taken on `pointerdown` retargets the subsequent native
  `click` to the capturing element — `fireEvent.click` in the component test
  bypasses real pointer capture entirely, so it stayed green throughout.
  `usePanZoom` now defers capture until movement crosses a 3px threshold.
  Separately, `Escape` closing the graph was in the plan and in a task brief,
  was never implemented, and passed that task's review, because the shell
  test only exercised the shortcut that opens the graph and the Back button —
  never Escape. Both are fixed and both are now named in
  `docs/rulings/testing-and-tooling.md` as a general caution: a review that
  verifies what exists, rather than checking each requirement by name, will
  not catch an omission the tests never asserted.

**Deferred, deliberately, not fixed:**

- Hover dimming re-renders the whole node and edge lists on every hover
  transition. Revisit only with a real-browser profile at ~2,000 nodes — no
  evidence yet that it costs anything a user would notice.
- The accessible summary reads "1 links" for a single edge. Pluralization was
  judged out of scope for this pass.
- A topology-hash collision between two different vaults would serve stale
  cached positions from `useGraphSnapshot`'s module-scope cache. Theoretical
  only — no plausible collision path was found or attempted.

### L4. Command palette — **SHIPPED 2026-08-31**

Spec: `docs/superpowers/specs/2026-08-31-l4-command-palette-design.md` (corrected
during Task 1 — the ranking section originally specified six rules; `allBoundary`
was deleted as provably redundant with `boundaryCount`, five remain).
Ledger: `.superpowers/sdd/2026-08-31-l4-command-palette/progress.md`.
Rulings: `docs/rulings/accessibility.md` (the combobox contract — a dedicated
input, focus that never moves into the list, `aria-activedescendant` asserted
by VALUE not presence, and `role="presentation"` group headers ruled over
`role="group"` to keep the option array a single flat index space).

`⌘K` opens a modal combobox over commands (four groups: navigation, note,
appearance, account) and, once something is typed, note titles. Subsequence
matching with a five-rule tie-break (`matchCommands.ts`), `buildCommands`
emitting only what is valid for the current state, and every destructive
command routed through `AppShell`'s existing `ConfirmDialog` rather than run
inline.

**Two things worth carrying forward:**

- **Navigation and theme commands needed NO new i18n keys.** The seven smart
  lists already had `smartList.*` translations from M6, and all sixteen
  `THEMES[].labelKey`s already existed from F — the palette's own new keys are
  only its own chrome and command labels (~28 strings across `en.ts`/`ko.ts`),
  not one per destination it links to. A feature that mostly routes to
  existing capability should look for this before adding a single key.
- **The bundle ceiling has now shaped two consecutive sub-projects (L2, then
  L4), and the guard itself was found broken and rewritten this pass** — see
  `CLAUDE.md`'s Toolchain surprises. Both signals pointed the same way, and
  **the budget was settled on 2026-08-31, before L5 started**: the ceiling is
  FROZEN at 346,500 B rather than ratcheting, a change that would exceed it
  goes lazy / to the server / gets cut, and raising it is now the user's
  explicit decision. See `docs/rulings/testing-and-tooling.md`.

**What the build corrected on its own way in:** the bundle guard's own method.
It measured "the largest single JS asset", valid only while the eager code was
one chunk; L4's second `React.lazy` boundary made Rolldown split the eager
code across three files, and the guard kept passing while looking at the
wrong one. Rewritten to walk the build manifest's static-import closure from
the entry chunk — see `scripts/bundleSize.test.ts`'s own docblock for the
before/after numbers.

**One known bug shipped deliberately, with its fix already worked out.** The
`sortBy.*` palette commands construct `{ field, newestFirst: true }`
unconditionally (`src/features/palette/commands.ts`), because `CommandDeps`
carries no read of the current `NoteOrder` — `onSetOrder` is a bare `setOrder`
in `AppShell`. `NoteOrder`'s own comment records that the flag inverts EVERY
field, so under `title` it means Z to A. Consequence: a user who has A-to-Z set
and picks "Sort by: Title" from the palette silently gets Z-to-A. **The command
changes two settings while naming one.**

It was found by L4's whole-branch review, confirmed in the code, and parked
rather than fixed because the sub-project's one allowed fix wave had already
run — not because it is acceptable. The fix is three lines: add
`order: NoteOrder` to `CommandDeps`, pass `order` in `AppShell`'s deps object
(it is already in scope there), and read `deps.order.newestFirst` in the
command body instead of the literal `true`. The preview-size commands are NOT
affected: `onSetPreviewSize` takes a bare value with no flag to preserve.

Do this before adding any further palette command that writes a compound
setting, because the same shape will recur.

### L5. Server-rendered Mermaid diagrams — **SHIPPED 2026-09-01**

Spec: `docs/superpowers/specs/2026-08-31-l5-mermaid-design.md`. Plan:
`docs/superpowers/plans/2026-08-31-l5-mermaid.md`. Ledger:
`.superpowers/sdd/2026-08-31-l5-mermaid/progress.md`.

` ```mermaid ` fences render as diagrams. The client never runs Mermaid: the
containerised Chromium that already renders PDF exports gained a
`/render/mermaid` endpoint, the API gained an authenticated `POST /diagram`
(60/min per session, sitting in front of a renderer reachable only from
`127.0.0.1`), and the client hashes the source, caches the sanitized SVG in
Dexie (schema version 6), shows it in a `codeBlock` node view that swaps to
the source while the caret is inside, and carries it into HTML and PDF
export. One cached render serves all sixteen themes: the SVG's own
`<style>` carries `var(--bear-*)` references verbatim, resolved against
whichever page it is inlined into.

**Nine of ten tasks executed as planned. What the tenth (verification) found
and corrected:**

- **A client-side Mermaid was measured and refused before any of this was
  built**, not merely assumed too expensive: 208 KB gzipped across 27
  requests for ONE flowchart, against a whole-app eager payload of ~343 KB.
  That measurement is what made this server-rendered from the start, not a
  fallback reached after a slower implementation was tried.
- **The theme CSS had to win a specificity fight, twice, and both losses were
  invisible to every gate except a rendered screenshot.** Mermaid emits
  `#d .label text` at specificity (1,1,1) and `#d text.actor > tspan` at
  (1,1,2); the first attempt at each selector in `mermaidTheme.ts` lost
  outright. And the glyphs live in a child `<tspan>`, not the `<text>`
  element a naive rule targets — on the eight dark themes, this shipped as
  near-black text on a dark fill, invisible to a passing suite, because
  `fill` is inherited and a `<tspan>` override upstream simply beat the fix.
  Three separate rounds of "fixed it" were verification failures rather than
  code failures: reading a `class` attribute instead of `getComputedStyle`,
  asserting a `var(--bear-*)` string was PRESENT in the stylesheet rather
  than that it actually WON the cascade, and measuring the parent `<text>`
  rather than the `<tspan>` that paints the glyph.
- **Every render used to hardcode `id='d'`, so two diagrams in one note
  collided** — Mermaid scopes every selector to that id
  (`#d .label text`, `url(#d-gradient)`, …), so a second diagram either
  rendered the first one's `<style>` twice or fought over the same anchors.
  Mermaid's OWN scoping was never the defect — measured at 0 unscoped
  selectors across flowchart, sequence and class. Fixed with a source-derived
  id, and `DIAGRAM_RENDER_VERSION` bumped 1 → 2 to invalidate every
  previously cached SVG, the first real use of that version-bump mechanism.
- **Deleting Mermaid's inline `max-width` was the wrong fix for a diagram
  that looked too small**, and measurement is what caught it: a small
  diagram (two boxes, one arrow) stretched to 1500px wide, filling the
  editor. Concrete `width`/`height` pulled from the SVG's own `viewBox` is
  the right fix — the diagram renders at its natural size and only grows if
  the note column is narrower than that.
- **Running the actual app, not just the test suite, found three defects no
  gate could see:** the rendered diagram's source was unreachable by mouse
  (clicking the picture did nothing — `figure` is `contenteditable=false`
  chrome ProseMirror will not place a caret inside, so a `mousedown` handler
  now redirects the click into the source); the copy button on a Mermaid code
  block silently copied nothing; and the SVG rendered left-aligned inside its
  container under Tailwind's preflight reset.
- **Two `npm install --no-save` calls in the same package.json-less Docker
  layer prune each other's packages.** The PDF image installs `playwright`
  and `mermaid` with `--no-save` in one `RUN`, matching the container's
  existing pattern of not touching a committed lockfile it does not have —
  but a second `--no-save` install in the same layer silently deleted
  `node_modules/playwright`, which broke the existing font-verification gate
  (`verify-fonts.mjs`) with no explanation beyond a missing module. Both
  packages now install in one `npm install --no-save` call.
- **A `--no-save` install must be cleaned up with `npm ci`, never a targeted
  `rm -rf node_modules/<package>`.** A hand-cleanup attempt during
  verification deleted the legitimate `d3-force` dependency L3's graph needs,
  because `--no-save` leaves no lockfile record of which packages were
  ever supposed to be there — `rm -rf` cannot tell "installed for this spike"
  from "installed for the app". `npm ci` restores exactly what the committed
  lockfile says belongs, nothing more and nothing less.
- **A 422 with an unreadable body rendered a literal `{detail}` to the user,
  in both locales** — the same defect shape M9b's `highlightClasses.ts`
  guard exists for: nothing crashes, nothing logs, and the only symptom is on
  screen. `requestDiagram.ts` reads the 422 body inside a `try`, and
  `MermaidDiagram.ts`'s `failureMessage` strips a trailing `: {detail}` when
  none was supplied rather than leaving the placeholder literal.

**The themed set is six diagram types, verified by looking, not six because
that number was assumed correct in advance.** `npm run shots:mermaid`
rendered flowchart, sequence, state, class, ER and pie through the real
container in `paper` (light) and `nord` (dark) — 12 files — and all six
themed correctly and legibly in both: node fills use `--bear-surface`, text
and edges use `--bear-text`/`--bear-muted`, and pie retains Mermaid's own
distinct per-slice fill palette — `mermaidTheme.ts`'s selectors theme the
title, legend and percentage labels, never the wedge fills themselves, which
is the right call: recolouring data slices to the app's theme would erase the
one thing a pie chart needs, distinct colours per category.
Every other Mermaid diagram type still renders, using Mermaid's own base
palette rather than the app's theme — legible, but outside the themed set;
growing that set is additive (add selectors to `mermaidTheme.ts`, bump
`DIAGRAM_RENDER_VERSION`, add a shot).

**Bundle cost, measured both sides rather than estimated, against the frozen
346,500 B ceiling:** `main` (pre-L5) measured 343,415 B; the finished branch
measures 346,045 B — a true eager cost of 2,630 B, leaving 455 B of headroom.
`CEILING_BYTES` did not move. The feature ships this cheaply specifically
because the render itself never reaches the browser: no Mermaid, no layout
engine and no theme CSS are in the client bundle at all — only the
node view, the cache repository, the request/error plumbing and the export
integration.

**One further defect, outside the ten planned tasks, found by the same
"run it and look" discipline the ledger above already credits: a
pre-existing race in `StoredImage.ts`'s object-URL lifecycle.** Verification
ran the full `test:e2e` suite for the first time on this branch (task
briefs before Task 9 never had), and `e2e/imageSync.spec.ts`'s second device
failed deterministically — 5/5 — while `main` passed 3/3 on the identical
test. The image node view used a single `released` boolean checked from
three call sites (`destroy()` unconditionally, plus two `if (released)`
checks in its async load), which double-released a reference whenever
`acquireObjectUrl`'s CACHED branch (a synchronous increment) and `destroy()`
both ran inside the same synchronous tick — exactly what three
mount/destroy/mount/destroy/mount cycles for one image produce on a fresh
document parse, which is not rare on its own but had never before combined
with a THIRD node view surviving to read the URL after the first two had
each driven the shared count down once more than their own share. The extra
`MermaidDiagram` plugin ahead of `StoredImage` in the extension list was
enough to tip timing into that window; the race itself predates L5 by three
sub-projects (K1/K2) and would in principle have been reachable by any
change that shifted initial-mount timing, this one included. Rewritten to a
single-ownership token (`heldUrl`) that both `destroy()` and the async load
check at every safe point, so exactly one of them releases each successful
acquisition — never both, never neither. Cost: 22 B of the 2,630 B total
above.

**And the first version of that fix reintroduced the bug one window later,
which is the part worth carrying forward.** The `if (destroyed)` block AFTER
`await files.get(id)` released without consulting `heldUrl` — unlike
`destroy()`, and unlike the check before it — so a view destroyed DURING that
await still released twice for one reference. It shipped with ZERO unit
coverage, on the reasoning that only the e2e race could see it, and that
reasoning is exactly what left the window open: the whole-branch review found
it, proved it with a test, and the fix is now `if (heldUrl !== null)` plus the
unit test that should have existed the first time.

**A sibling defect in `src/lib/objectUrls.ts` is KNOWN, DELIBERATELY UNFIXED,
and more reachable than it looks.** Its in-flight join (`objectUrls.ts:38`)
returns the pending URL without incrementing `count`, so two acquirers in the
same tick share one count and the first release revokes for both. The L5
review measured it: two node views for one id, one destroyed mid-flight,
revokes the URL **before the second view mounts**, leaving a live
`<img src="blob:…">` pointing at a revoked URL — and it is reachable from a
SINGLE mount, not only from two views. It is byte-identical before and after
L5 and predates the branch by three sub-projects, so it was ruled out of scope
rather than fixed under a merge gate — fixing unrelated pre-existing code to
get a gate green is precisely how the `StoredImage` excursion above went wrong
the first time. Fix it deliberately, with its own tests, not as a rider on
something else.

### M. Publish: a public read-only URL for one note — **SHIPPED 2026-09-01**

Spec: `docs/superpowers/specs/2026-09-01-m-publish-design.md`. Plan:
`docs/superpowers/plans/2026-09-01-m-publish.md`. Ledger:
`.superpowers/sdd/2026-09-01-m-publish/progress.md`.

A note can be published to an unguessable public URL. The client posts the
same standalone HTML document it already builds for HTML export; the server
stores it on disk under a 128-bit capability id (`randomBytes(16).toString
('base64url')`) and serves it back from `pub.markflowing.com` — a second
hostname the Cloudflare tunnel routes to the same process — behind a CSP that
neutralises any script the author's raw HTML carried in, plus `noindex`,
`nosniff` and `no-referrer`. Every app route 404s on that hostname, and
`/p/*` 404s everywhere else. The dialog behind `ExportMenu`'s "Publish to
web" item shows the URL, the publish time, and republish/unpublish, behind
its own `React.lazy` boundary.

Eight tasks, executed largely as planned. What the build corrected:

- **A client-side render was never on the table**, and this was ruled out
  before implementation rather than discovered during it: `server/` may
  import nothing from `src/` but `src/data/types.ts`, so a live re-render on
  the server would need the whole editor pipeline reimplemented there. The
  snapshot model — publish is a photograph of the note at that moment, not a
  live view — is what the architecture boundary permits, and the client had
  already built the document for HTML export anyway.
- **One process serving two hostnames means the whole API answers on the
  anonymous one until something stops it, and this was MEASURED, not
  assumed.** Before `publishHostOnly` existed, `pub.markflowing.com/health`
  answered 200 — and so would `/auth` and `/sync`, on a hostname that serves
  author-controlled HTML with no origin policy of its own. The guard fails
  closed in both directions: an unrecognised or absent `Host` is treated as
  the app host, which serves no public pages.
- **`originGuard` needed no exemption for the publish route — the plan's own
  spec claimed otherwise and was wrong.** `server/src/middleware/origin.ts`
  returns early for every safe method (`GET`/`HEAD`/`OPTIONS`), so a public
  `GET /p/:id` already passed it before this sub-project touched anything.
  Self-review caught this before a task was built around a guard that did not
  need building.
- **Hono normalises `.` and `..` in a path before routing, which made two
  planned fault injections unfalsifiable.** The id-shape guard's test wanted
  to prove a path-traversal-shaped id gets rejected, but `../x` and similar
  never reach the handler at all — Hono's router eats them first. The lesson
  drawn was not "the guard is unnecessary" but "the test picked an input the
  router already refuses": `a.b` (a dot that survives normalisation) does
  reach the handler and proves the guard, and removing the guard entirely
  turns that case into a 500 where a 404 belongs.
- **Cloudflare's ETag behaviour needed a real tunnel to find, and it is
  stranger than the plan assumed.** The working theory going in was "Cloudflare
  weakens a strong ETag to `W/"…"` when it compresses," which is why
  `publicPage.ts` implements RFC 7232 comparison (accepting either form)
  rather than a bare `===`. Verification found something more surprising:
  through the real tunnel, Cloudflare does not weaken the `ETag` header, it
  **removes it entirely** — a real browser landing on a published page today
  has no way to learn the value at all, weak or strong. The comparison logic
  is still correct and still worth having (proven: a client that already
  holds a valid value, from hitting the origin directly, gets a real 304 back
  through the tunnel when it sends that value as `If-None-Match`), but the
  practical payoff — conditional GETs saving bandwidth on a re-visited
  published page — does not yet exist for an ordinary visitor. Recorded as an
  open question in `server/README.md` rather than chased further inside this
  sub-project; the fix, if one is wanted, is almost certainly a
  `Cache-Control` header Cloudflare will treat as worth validating, not
  another change to the comparison function.
- **A hand-rolled modal shipped without a focus trap, on a false trade-off.**
  `PublishDialog.tsx`'s `Modal` deliberately avoids importing `@/ui/Dialog`
  (a third crossing consumer of a module already shared by `AppShell` and
  `CommandPalette` tips Rolldown into extracting a shared chunk that lands in
  the EAGER bundle regardless of which side of the lazy boundary asked for
  it — measured at +773 B against the headroom available at the time), and
  the first version of the reimplementation dropped the Tab-wrap branch,
  reasoning that a keyboard trap wasn't worth the byte risk this late in the
  budget. Pasting that branch back in, verbatim from `Dialog`'s own, measured
  **+6 B**. There was never a real trade-off; the estimate that produced one
  was never checked against a real build.
- **`listPublished` had no caller**, so a published note reopened after a
  reload showed "not yet published" with no route to Unpublish at all — the
  server remembered the page; the client had simply never asked it.
  `PublishDialogContainer` now calls it once, on mount, whenever the caller's
  own `page` prop is still `null`.
- **A third `React.lazy` boundary re-chunks the eager code, and the cost is
  bigger than the feature's own weight.** Adding `PublishDialogContainer`
  alongside L3's `GraphView` and L4's `CommandPalette` boundaries cost ~330 B
  of pure re-chunking overhead beyond the ~350 B the feature's own strings and
  wiring account for. That combined cost is what moved `CEILING_BYTES` from
  346,500 to **347,000**, an explicit decision the user made with the
  arithmetic in `scripts/bundleSize.test.ts`'s docblock — not something a
  future change should treat as a precedent for raising it again.

Bundle: **232 B** of headroom against the 347,000 B ceiling, measured off a
real `npm run build`, not estimated. Test counts after this sub-project: see
`CLAUDE.md`'s status table.

### C. Code block language + syntax highlighting — SHIPPED 2026-08-24

Language autocomplete on the fence (typing ` ```java ` suggests `java`,
`javadoc`, `javascript`, …), and the highlighting that motivates it.

- **Nothing exists today**: no `lowlight`, no `highlight.js`, no language UI.
  Code blocks are plain text.
- **This is the only one of the three that can make the app worse at its stated
  goal.** Highlighting means shipping grammars into a bundle already at 847 KB,
  for an app whose first two adjectives are *lightweight* and *fast*. A curated
  language subset is the likely answer, but it is a decision to take
  deliberately, not to discover afterwards.
- Last, so the bundle decision is made with the other two already banked.

**The bundle cost is now MEASURED, on 2026-08-24, and both earlier estimates
were wrong.** Spiked on a throwaway branch with `lowlight` +
`@tiptap/extension-code-block-lowlight` and a twelve-language roster (bash,
css, java, javascript, json, kotlin, markdown, python, sql, typescript, xml,
yaml), then fully reverted — `main`'s bundle is byte-identical at 278,028
gzipped.

| approach                     | main bundle          | on demand                      |
| ---------------------------- | -------------------- | ------------------------------ |
| today (pre-C baseline)       | 278,028 gz           | —                              |
| curated set, **eager** (spike, WRONG — see below) | 301,244 gz (+23,216) | nothing |
| curated set, **lazy**        | 286,630 gz (+8,602)  | 12 chunks, 431 B – 4,324 B each |
| curated set, **eager** (shipped, MEASURED)        | **314,367 gz (+36,339)** | nothing |

The user chose lazy when the options were labelled "~5 KB" and "60–90 KB".
Both figures were guesses and both were wrong: the real gap, once C actually
shipped, was **8.6 KB versus 36.3 KB**, or 3.1% versus 13.1% of the pre-C
bundle. Lazy is still the smaller number, but it buys 27.7 KB at the cost of
an async registry, a flash of unhighlighted code on first paint of a block,
and a loader that tree-shakes to nothing if it is ever left unreferenced —
which happened during the spike and silently produced a "lazy" build
containing no languages at all.

**RULED 2026-08-24: EAGER. This reverses the earlier lazy choice, and the
reversal is the whole point of having measured.** The user re-decided once the
numbers were real. 14.6 KB gzipped does not buy an async registry whose
failure mode is a build that succeeds, runs, and highlights nothing — the
spike produced exactly that build. Eager was believed to be +23.2 KB on a
278 KB baseline at ruling time; it stays the right call regardless, because
the argument for it never rested on the byte count.

**The `+23,216` spike figure above was wrong, and finding out took three more
re-measurements after the ruling shipped.** Every one of them found the real
number higher than the last: `+31,825` (Task 2, the picker not yet built),
`+34,886` (Task 7, after export and the second lowlight registry), and the
final shipped figure, `+36,339` — **57% above the spike's `+23,216`**, not the
"37% off" it looked like partway through. The spike under-measured because it
never built the picker, the export re-highlighting pass, or the
guessing/declining lowlight split — real cost this ruling's argument did not
depend on, but its own headline number should have reflected. The ruling
itself is UNCHANGED by this: it rested on the lazy loader's silent-failure
mode, not on any of these four numbers being right. `scripts/bundleSize.test.ts`
now holds the final, real figure as an enforced ceiling (`324,000`, ~3%
headroom over the measured `314,367`) specifically so a fifth wrong number
is a compile-time fact instead of a comment someone has to remember to
distrust.

Do not re-open this on bundle-size grounds alone; it was re-opened once
already, with measurement, and settled. What WOULD justify re-opening it: the
curated roster growing past twelve languages, since CSS alone is 4,324 B
gzipped and the cost is not uniform per language. If the roster grows, measure
again — with a real build, not a spike — rather than assuming the ruling
scales, and rather than trusting a recorded number without recomputing it.

Three further facts from the spike:

- **`@tiptap/extension-code-block-lowlight` must be version-pinned.**
  `npm i` unpinned fails `ERESOLVE` against `@tiptap/core@3.29.2`;
  `@3.29.2` installs cleanly.
- **`highlight.js` arrives as a transitive dependency of `lowlight`**, so
  both appear in `node_modules` from one install.
- **CSS is the largest grammar at 4,324 B gzipped**, an order of magnitude
  above JSON's 431 B — a per-language budget is not uniform.

**Follow-up, named but unscheduled: per-theme syntax-palette overrides.** The
six-role syntax palette is twelve shared literals interpolated on
`--bear-dark`, identical across fifteen of sixteen themes; `high-contrast`
already has the one override that exists, because pure `#000000` defeats the
shared values outright (see `docs/rulings/design-tokens-and-layout.md`). A
visual review of all sixteen themes (`npm run shots`, the `13-editor-code-*`
frame) found no other theme where the shared palette clashes or reads as
illegible — `paper`, `ink`, `high-contrast`, `solarized-light` and `nord` were
inspected directly and all six roles are legible and distinct in each. Two
themes carry thin contrast margins worth watching rather than fixing now:
`sepia`'s `faint` clears by 0.02 and `gruvbox-light`'s `code-number` by 0.051
(both recorded in the rulings file). If a future theme addition or a palette
tweak produces a clash the shared literals cannot fix without breaking a
different theme, the mechanism is already shipped and proven
(`high-contrast`'s override block) — the follow-up is deciding WHICH of the
other fifteen themes, if any, need the same treatment, not building new
infrastructure.

## Cut, with a reason

- **"여기로 링크 복사" (copy link to here)**, from Bear's heading dropdown. It
  needs per-note and per-heading URLs, and this app has no routing at all — no
  history, no deep links. That is a fourth sub-project wearing a menu item's
  clothing.
- ~~**M9b callout blocks.**~~ **SHIPPED 2026-08-27** — struck from this list
  rather than deleted from it, because "deliberately not chosen this round"
  was the right call at the time and the record of it is worth keeping. Spec:
  `docs/superpowers/specs/2026-08-27-m9b-callout-blocks-design.md`. Plan:
  `docs/superpowers/plans/2026-08-27-m9b-callout-blocks.md`.

  **It opened with a corruption fix rather than a feature.** `> [!NOTE]`
  serialized to `> \[!NOTE\]`, so merely opening and saving a note carrying a
  GitHub alert rewrote it, and nothing in the suite could see it. Findings
  worth carrying forward:

  - **`extend({ addInputRules })` REPLACES the base implementation.** Extending
    Blockquote silently cost it its own `> ` rule; no unit test could see it
    because none of them type.
  - **A lenient `renderMarkdown` would have HIDDEN data loss.** `calloutTitle`
    has none deliberately, so a node in an invalid position serializes to
    nothing and the loss is observable in a test rather than only in a note.
  - **A fill identical to the page passes a 4.5 contrast check perfectly.**
    Five extra rows exist purely to stop the other five being vacuous.

## The goal, clause by clause

The stated goal is "lightweight, fast, beautiful, easy to use, markdown,
**image storage**".

**Image storage is no longer the missing clause.** This section said for weeks
that no milestone had ever scheduled it; K1 (capture and display), K2 (the Mac
Mini as an image store) and K3 (resize, and images in every export) shipped
between 2026-08-26 and 2026-08-27. What remains of K is K4's thumbnail, which
is cosmetic.

**"Easy to use" is the clause that is now furthest from true**, and it is
furthest on a phone specifically. See J2–J4 above. That is the honest
successor to this section's original claim, and it is why mobile leads the
open list rather than B2.

## D. Server sync and OAuth login — **D1 AND D2 BOTH SHIPPED**

Spec: `docs/superpowers/specs/2026-08-21-d-server-sync-and-oauth-design.md`.
Plan: `docs/superpowers/plans/2026-08-23-d2-sync-protocol.md`.
Rulings: `docs/rulings/sync.md`.
It supersedes this section; the notes below are kept only where the spec cites
them. **Read the spec, not this.**

Raised by the user mid-session while A was being planned: a MariaDB instance in
Docker on a local Mac Mini, and OAuth2 login with Google, GitHub and Naver.

**Two things below were overturned during the 2026-08-21 brainstorm:**

- ~~**Single user.**~~ **STRUCK.** D is a real multi-tenant product with open
  signup: guest mode on IndexedDB with no account, and per-user isolated notes
  once signed in. The user reversed this deliberately after being shown the
  cost. Consequence: rate limits, per-user quota and `DELETE /account` are
  day-one requirements.
- ~~**Naver.**~~ **DROPPED from D.** Google first, then GitHub. Not ruled out
  later.

Settled by the same brainstorm: the app moves to the apex **`markflowing.com`**
(Pages, `base: '/'`) with the API at **`api.markflowing.com`** (Cloudflare
Tunnel), because same-site is what allows an HttpOnly cookie session instead of
a token in localStorage. Server is **Node + TypeScript in `server/`** as a fifth
tsconfig project, so it imports `src/data/types.ts` and cannot drift. Conflict
resolution is **last-write-wins with the losing edit kept as a `(conflict)`
note**. Sync is automatic and quiet. D splits into **D1** (hosting, accounts,
Google login — no note data on the wire) and **D2** (the sync protocol).

**This reverses the project's founding premise** — "No backend, no account —
everything lives in the browser's IndexedDB" — so it is not a feature in the
A/B/C queue. It gets its own brainstorm, spec and plan.

Decisions already taken, so they are not re-derived:

- **Local-first is KEPT.** IndexedDB stays the source of truth; the server is a
  sync target holding a per-user copy for backup and cross-device access. The
  app must keep working with the Mini asleep or off-network. Consequence: this
  project owns a conflict-resolution decision (last-write-wins, per-note
  versioning, or CRDT) and that is its hardest part, not the schema.
- ~~**Single user.** OAuth is identity for sync, not multi-tenancy.~~ **STRUCK
  2026-08-21 — see the strike above.** Open signup, per-user isolation. Sharing,
  permissions and per-note ACLs remain out of scope.
- **A ships first.** Nothing in A depends on this, and this does not block A.

Constraints established when it was raised, each of which shapes the spec:

- **A browser cannot speak MySQL's wire protocol.** "Hook up MariaDB"
  necessarily means an HTTP API service in front of it. The server is the
  project; the database is the small half.
- **OAuth2 needs a confidential client**, so the Google / GitHub / Naver
  secrets live on that server and never in the bundle. Naver additionally
  requires registered redirect URIs.
- **The live site is `https://valorjj.github.io/bear-web/` and cannot reach a
  Mac Mini on a LAN.** Mixed content blocks `http://`, and a local hostname is
  not routable from outside the network. A public HTTPS endpoint (Cloudflare
  Tunnel or equivalent) plus CORS is a prerequisite, not a detail — without it
  the deployed app and the local app become two different products.
- **"Runs every day" is not "always."** Availability gaps are the normal case,
  which is exactly why local-first is kept.

### D1. Hosting, accounts, Google login — **SHIPPED 2026-08-21**

**D1 shipped, merged, deployed and was verified live on 2026-08-21.** Real
Google sign-in works on `https://markflowing.com`; the session row, the
`__Host-` cookie, and the 401/403 paths were all confirmed against the running
deployment, not only against tests.

### D2. The sync protocol — **SHIPPED 2026-08-23**

Plan: `docs/superpowers/plans/2026-08-23-d2-sync-protocol.md`. Ledger:
`.superpowers/sdd/2026-08-23-d2-sync-protocol/progress.md` (gitignored,
deleted after this session — everything worth keeping from it is folded into
`docs/rulings/sync.md` and here).

What landed: the per-account revision counter, `GET`/`POST /sync` with
tombstones and a 90-day sweep, Dexie version 3 plus a `syncState` table,
dirty-tracking on every note and tag write, the sync engine
(`createEngine(deps).syncOnce`), a four-state status indicator in the account
menu, the guest-note adoption dialog for a first sign-in or an account switch,
and the `(conflict)` note for a losing edit. **This is the change that makes
the D paragraph above literally true: note data now crosses the network.**
`src/data/sync/`, `syncState` and `src/features/account/` are the modules a
future change to any of this touches — see `docs/rulings/sync.md` for the
constraints no test enforces before touching them.

Ten things diverged from the plan or were only found during review, each
worth carrying forward rather than rediscovering (full detail in
`docs/rulings/sync.md`):

- **The tag-reindex helper was duplicated verbatim by two tasks** written from
  the same plan; extracted once, to `src/data/reindex.ts`'s `reindexNote`,
  used by both the notes repository and the engine.
- **The sync cursor and `SyncOutcome.rev` never move backwards** —
  `Math.max(remote.rev, result.rev)`, not `result.rev` — because a push that
  wrote nothing reports a lower revision than the pull already advanced past.
- **The `(conflict)` marker lives in the copy's TEXT, not its `title`.**
  `deriveTitle` re-derives `title` on the next edit and on the moment a second
  device pulls the copy, so a title-only marker evaporates exactly when it is
  most needed.
- **A conflict comparison widened to metadata (`pinned`/`trashedAt`/
  `archivedAt`) was tried and reverted.** It resurrects, on every device, a
  note trashed on two devices at once — worse than the text-only comparison it
  replaced, which was already correct.
- **Two data-loss paths were found and closed in review**, both in the
  engine's accept loop: a purge landing mid-push (fixed by reading the
  CURRENT `syncState` row, not the collected snapshot) and `markAllDirty`
  pinning every row `dirty` forever (fixed by stamping each note's own
  `updatedAt`, not one shared "now", as `markedAt`).
- **`useT()` takes no arguments; this app has no string interpolation at
  all.** The plan guessed a `{count}` placeholder for the adoption dialog's
  count; it does not exist, and the dialog composes its sentence from two
  separate translation keys instead.
- **The rate limiter on `/sync` keyed on the raw `Cookie` header**, so any
  caller varying one byte got a fresh bucket — fixed to key on the extracted
  session token, falling back to `clientIp` only when absent.
- **`readBatch`'s validation gap accepted a note missing
  `trashedAt`/`archivedAt`/`pinned`/`deleted`/`createdAt`** and let it reach
  `mysql2`, which throws on an `undefined` bind parameter. Worse than a
  crash: the pre-fix behaviour was actually a silent **200**, i.e. malformed
  data accepted rather than rejected. Now a 400 before any SQL binding.
- **Import no longer resets `syncedRev` to 0.** Clearing it on import made
  the user's own restored backup lose to the server copy and land as a
  `(conflict)` note on the most ordinary import flow there is — preserving
  `syncedRev` lets the import correctly overwrite the server's copy instead.
- **A unit-test flake in `NoteEditor.test.tsx` was found, chased down, and
  fixed the way commit `ca40a16` fixed the same class of problem in
  `AppShell.test`: the `waitFor` ceiling around `notes.purge` was raised, not
  the assertion changed**, after reproducing the failure reliably under load
  at a lowered ceiling. Task 5 added a `syncState` get+put inside
  `notes.purge`, narrowing the margin on an already-tight test.

**Corrected debt this session found while touching the numbers below: the
e2e flake count is THREE, not two.** `smoke.spec.ts:102` joins the two
`appearance.spec.ts` flakes already known — its cause is named:
`usePaneWidths` writes settings fire-and-forget with no way for a test to
await the write, and D2's own `syncState` get+put on every note write shifted
timing enough to surface it more often. None are D2 regressions — the failing
set varies run to run and every one passes in isolation.

**Not part of D2, named and deferred rather than silently dropped** (see
`docs/rulings/sync.md`'s "Known gaps" section for the full list): import
being "replace" locally but "merge" against the server; an orphaned
`syncState` row surviving an import at `dirty: 0`; `sweepTombstones`'s
non-atomic count-then-delete; the tag accept branch's missing in-flight-edit
guard; `AdoptNotesDialog` mounting unconditionally beside the account
popover.

**Two things D1 built that D2 depended on, exactly as anticipated:**
`pool.transaction()` and `users.rev_counter` (`001_init.sql`) — no migration
was needed to start using either.

**Live environment facts that are not recoverable from the repo:**

- `server/.env` holds PRODUCTION origins; `server/.env.local` (gitignored,
  documented in `server/.env.example` and `server/README.md`) holds
  localhost ones for `npm run server:dev:local`. **The two servers cannot run
  at once** — both want port 8787, the one redirect URI registered in the
  Google console.
- The `markflowing` tunnel is the machine's **single** cloudflared connector;
  the tool allows only one system service per machine. `lunch-api`,
  `docs-api` and `yjs` were deliberately deleted — those projects are retired.
- MariaDB is `markflowing-mariadb` on **127.0.0.1**:3308 (loopback, not all
  interfaces). Dev database `markflowing`, test database `markflowing_test`.
- **The API server IS a service now, as of 2026-08-24.** `com.markflowing.api`,
  a LaunchAgent with unconditional `KeepAlive`; plist tracked at
  `server/launchd/com.markflowing.api.plist`, controlled by the
  `server:service:*` npm scripts. Named debt at D1, restated at D2, built
  after F. It was found **already down** when the work started — the tunnel up
  and `api.markflowing.com` answering 502 — which is the third occurrence of
  the failure it fixes. `kill` no longer stops the server; use
  `npm run server:service:stop`.
- **The repo moved to `~/WebstormProjects/bear-web` because of this**, and the
  reason is not cosmetic: **a launchd job cannot read `~/Documents`, and it
  hangs rather than failing.** The first working plist produced a process that
  sat alive forever with an empty log and nothing bound, blocked in
  `open()` on a TCC-protected path — no denial logged, and `KeepAlive` saw a
  healthy job because it never exited. Full detail in `server/README.md`.
  Do not move the repo back under `~/Documents`, `~/Desktop` or `~/Downloads`.
- **Sleep behaviour is measured-not-assumed and still open.** A LaunchAgent
  fixes a closed terminal, a crash and a reboot. Whether the Mini *sleeping*
  kills it was deliberately left to a separate probe with evidence behind it,
  rather than blanket-disabling sleep for a machine that also hosts five
  Actions runners and ollama. Local-first means the app is fine either way.

**Known debt, carried forward. None of it blocks anything queued:**

- **`ThemePicker` has the same `overflow-hidden` clipping bug** `AccountMenu`
  had, just narrower so it has not bitten. The fix mechanism now exists in
  `AccountMenu` — viewport-coordinate placement — and is a small change.
- **The rate limiter's window `Map` is never pruned.** One stale entry per
  distinct key, forever. Wants a TTL sweep before the service is left
  unattended for long stretches.
- **Sessions roll forever with no absolute cap.** A stolen token that keeps
  being used renews indefinitely. A rolling-vs-absolute design tradeoff, not a
  bug.
- **The OAuth transaction is replayable within its 600s lifetime.** Stateless
  by design; single-use enforcement comes from the provider rejecting code
  reuse. Documented honestly in the code and in `server/README.md`.
- **The default database password is still `markflowing`**, left because
  changing it breaks the existing volume.
- **Three intermittent e2e tests**, not two: `appearance.spec.ts:893`,
  `appearance.spec.ts:1021`, and now `smoke.spec.ts:102`, each passing in
  isolation. Playwright retries them; Vitest does not retry, so a flaky
  *unit* test turns main red where a flaky e2e test is merely reported —
  which is exactly the class of bug the `NoteEditor.test.tsx` fix above
  addressed for the one place D2 could see it.
- ~~**Giving the API server a launchd service and a non-watcher start
  command**~~ — **DONE 2026-08-24.** See the service entry above.
- The "known gaps" list in `docs/rulings/sync.md` — none block anything
  queued, all are named there rather than here so they stay next to the
  constraints they qualify.


## J. Mobile — J1, J2a, J2 and J3 SHIPPED; only J4 remains

**The starting point was worse than "cramped".** Measured at 390×844 before
anything was written: sidebar 240 + note list 320 + two resizers laid out wider
than the screen, so the editor pane sat entirely off it, and `<main>`'s
`overflow-hidden` meant `scrollWidth === clientWidth === 390` — the page could
not be scrolled to reach it. A phone user could tap a note and never see one.
`src/styles/` contained no responsive rules whatsoever.

Decomposed into four sub-projects because it is far too large for one spec, and
because J1 alone converts "unusable" into "usable" while nothing else is even
testable until it exists.

### J1. Responsive shell and navigation — SHIPPED

Spec: `docs/superpowers/specs/2026-08-26-j1-mobile-shell-design.md`.
Plan: `docs/superpowers/plans/2026-08-26-j1-mobile-shell.md`.

Three modes (`phone` < 640, `tablet` < 1024, `desktop`), a `Dialog` drawer for
the tag sidebar, a derived phone screen, and one history entry per overlay so
the platform back gesture works without a router.

**Findings worth carrying forward:**

- **1024 is chosen against Playwright's viewport, not by taste.** Seven
  existing assertions that the shell has three panes depend on it.
- **`document.scrollWidth` cannot see an overflowing pane** when the container
  is `overflow-hidden` — it reads the viewport width either way. That is the
  very reason the original defect was invisible, and the first version of the
  e2e guard was vacuous because of it. Measure each pane's box instead.
- **Reproducing the original defect needs BOTH a rendered sidebar and a
  fixed-width list.** Either alone passes, because flex children shrink.
- **`SHELL_CHROME_WIDTH` shipped wrong (56, forgetting one of two resizers)
  and one e2e test caught it on its first run.** A constant made falsifiable
  is worth more than a constant asserted to be right.
- **Two existing appearance tests changed MEANING rather than going stale.**
  The toolbar-overflow test's 900px premise disappeared (that width is now a
  two-pane tablet with a ~556px editor) and the defect moved to 390px; the
  prose-floor test's ~96px editor pane became unreachable, because
  `maxPaneWidth` now stops the resizers squeezing it below 160.

### J2. Touch parity — SHIPPED 2026-08-27

Spec: `docs/superpowers/specs/2026-08-27-j2-touch-parity-design.md`.
Rulings: `docs/rulings/design-tokens-and-layout.md`,
`docs/rulings/testing-and-tooling.md`.

**J2a shipped separately on 2026-08-26** — the phone header's proportions and
its 44px targets — and was not the whole of J2.

The ruling this sub-project existed to make: **hybrid, not one gesture.**
Editor-gutter controls rest visible on a device that cannot hover; the note-list
row gets long-press. Long-press is not an option inside a `contenteditable`,
where the OS already owns that gesture for select-word-and-callout, and iOS
Safari raises no `contextmenu` from a long press at all. The row's pin rests
visible AND long-press ships — neither replaces the other, because long-press is
invisible and the other four row actions have no touch route without it.

**Findings worth carrying forward:**

- **A long press opens a menu and the browser's own synthetic mouse burst
  closes it in the same frame.** Every mobile browser replays a touch as
  `mousedown`/`mouseup`/`click`, and `useAnchoredMenu` dismisses on an outside
  `mousedown` in the CAPTURE phase. It takes `stopImmediatePropagation` —
  `stopPropagation` only stops other NODES, and both listeners are on
  `document` — gated on the pointer type, or a real right-click loses the click
  on the menu item the user then chooses.
- **The spec's menu-item plan was wrong and was corrected mid-flight.** A 44px
  `::after` on a 26px menu item overlaps its neighbours, so a near-miss selects
  the wrong command — Delete among them. Menu items grow `min-height` instead,
  applied by explicit ARIA role in one declaration across ten menus, and the
  seven-file class extraction the spec called for was never performed.
- **Three tests could not fail until a fault injection said so**, each for a
  different reason: a note's first block is its title and is never foldable; a
  Playwright `name` is a case-insensitive substring; and neither `.click()` nor
  a tap can prove a `(hover: none)` rule, because Chromium applies sticky
  `:hover` on touch.
- **`hasTouch: true` alone flips both `(hover: none)` and `(pointer: coarse)`
  in Chromium**, with or without `isMobile`. Verified with a throwaway probe
  before the design was written, because if it had come back false none of this
  would have been testable.

### J3. The editor on a phone — SHIPPED 2026-08-27

Spec: `docs/superpowers/specs/2026-08-27-j3-phone-editor-design.md`.
Rulings: `docs/rulings/design-tokens-and-layout.md`,
`docs/rulings/testing-and-tooling.md`.

The keyboard, the toolbar, tables that scroll, and three menu clamps moved off
`100vh`.

**Findings worth carrying forward:**

- **Two keyboard mechanisms are safe together because of ARITHMETIC, not
  feature detection.** `interactive-widget=resizes-content` shrinks the layout
  viewport where honoured, so `innerHeight` and `visualViewport` agree and the
  JS fallback's computed inset is naturally 0. There is no reliable way to
  detect support, and none is needed.
- **`window.innerHeight` is the wrong number for anything that must stay on
  screen.** On iOS a keyboard does not change it. `useAnchoredMenu` was
  deciding a menu "fits below" into covered space.
- **Table layout does not reward reasoning.** Three plausible ways to floor a
  column's width do nothing, silently and identically to no rule at all. Only
  `col { min-width: … !important }` works, outranking Tiptap's inline style.
- **A line no test can falsify came back out.** `coarse:pb-32` grew the
  toolbar's reserve; the strip reaches 68px against `pb-24`'s 96, so nothing
  could be made to fail with it absent.
- **`expect.poll` hid a missing listener for a whole test.** Poll for a state
  you are waiting for, never for one you are asserting did not drift.
- **This item's own first line was stale.** The top pill does not overlap the
  note title and had not for some time; `pt-12` reserves exactly its height.

### J4. Platform chrome — NOT STARTED

Safe-area insets throughout, `100dvh`, installability, pull-to-refresh, and
whether an installed PWA changes J1's answer on routing. J1 carved out one
exception and only one: the FAB's own `env(safe-area-inset-bottom)`.


## K. Image storage — K1, K2 and K3 SHIPPED; only K4 remains, and it is cosmetic

The goal's one clause that had never been scheduled by any milestone or
sub-project. Decomposed into four, because it touches the data layer, the
editor, sync, export and the server.

Spec: `docs/superpowers/specs/2026-08-26-k1-image-capture-design.md`.
Plan: `docs/superpowers/plans/2026-08-26-k1-image-capture.md`.

### K1. Capture and display, locally — SHIPPED

Paste or drop a screenshot; one downscaled WebP in IndexedDB;
`![](files/<id>.webp)` in the Markdown; a `StoredImage` node with a
reference-counted object URL. Offline, one device.

**Findings worth carrying forward:**

- **The save-time reclamation sweep in the spec would have destroyed data**,
  and the test written to guard it caught that: autosave's debounce is a few
  hundred milliseconds, which is not an undo window. Reclamation moved to
  startup. The test discriminates — it fails against the original design.
- **The note-list thumbnail was making third-party requests.** It read the
  first REMOTE image URL out of the Markdown and rendered it, so the app did
  exactly what K1's privacy rule forbids, one pane over, for the whole of
  sub-project I. Found by an e2e test routing the host. K4's thumbnail rewire
  was pulled forward because of it.
- **The bundle ceiling was 89 bytes from being breached** before K1 started
  (323,911 against 324,000). All of K1 cost 1,555 B gzipped.
- **Typing Markdown never parses as Markdown** — serializing a text node
  escapes it. Tests must seed; inserting code must insert a node.

### K2. The Mac Mini — SHIPPED 2026-08-26

Spec: `docs/superpowers/specs/2026-08-26-k2-image-sync-design.md`.
Plan: `docs/superpowers/plans/2026-08-26-k2-image-sync.md`.

`PUT`/`GET /files/:id`, bytes on disk under `IMAGE_ROOT`, metadata in
`image_files`, upload driven by the sync engine after notes, lazy download on a
miss. Its own 2 GiB quota.

**Findings worth carrying forward:**

- **K1 shipped a data-loss bug that K2 found.** `notes.duplicate` copies a
  note's text, so two notes can reference one image while the file row names
  only the original — and K1's boot sweep asked the OWNING note, so deleting
  the image from that original destroyed the duplicate's copy. The sweep now
  asks whether ANY note references the id.
- **The engine's early return skipped image uploads.** An account whose only
  change was a pasted screenshot sat unsynced until the user edited a note.
- **The multi-tenancy guard had a gap**: it accepted a bare `user_id` on
  `INSERT INTO` but not on `INSERT IGNORE INTO`, flagging a legitimate
  statement. Widened, and re-verified that it still rejects a `SELECT` missing
  its predicate.
- **The API is not containerised.** Only MariaDB and the PDF renderer are, so
  `IMAGE_ROOT` is a host path — outside the repo, and outside the
  TCC-protected directories where a launchd job hangs rather than fails.
- **An unanswered modal reads as an unstable element** in Playwright, not as a
  modal: device B boots signed in with local notes and `AdoptNotesDialog`
  intercepts every click until answered.

### K3. Resize and export — SHIPPED 2026-08-26

**SHIPPED 2026-08-26.** Spec:
`docs/superpowers/specs/2026-08-26-k3-resize-and-export-design.md`. Plan:
`docs/superpowers/plans/2026-08-26-k3-resize-and-export.md`.

A display width in the Markdown (`![alt|640](…)`), a drag grip and
`Mod-Alt-Arrow` chords, images inlined into HTML and PDF, and Markdown as a
store-only zip.

**Findings worth carrying forward:**

- **K1 shipped a second bug that K3 found**: a note whose whole text is one
  image parsed to an INVALID document, and typing into it threw. Reachable by
  pasting an image into an empty note and reloading.
- **The renderer's isolation shaped the design rather than being worked
  around**: its browser cannot resolve any host, so images inline as data
  URIs, which forced `MAX_EXPORT_BYTES` from 2 MiB to 20 MiB. (Reworded
  2026-08-27: this said "it has no route off the host", which is G's control 4
  — and control 4 is NOT built. See `docs/rulings/export.md`.)
- **A hand-written zip cannot be validated by its own reader.** `unzip -t` is
  the only thing that can catch a wrong CRC.
- **A text extraction cannot see a missing image in a PDF**, the same way it
  cannot see tofu — the assertion has to be structural or rasterised.

### K4. The thumbnail — MOSTLY DONE IN K1

The privacy half shipped early. What remains is cosmetic: the row currently
shows the first stored image, and could show a smarter choice.
