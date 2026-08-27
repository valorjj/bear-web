# Next up

Written 2026-08-20 after M8 + M9a shipped; last reconciled against
`CLAUDE.md` on **2026-08-27**, when M9b shipped.

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
  through **M9b (callout blocks), 2026-08-27**. Live on Pages.
- 2119 unit tests, 154 end-to-end. All six gates green.
- Every sub-project branch named in this file is merged and deleted.

**What is actually left, as of 2026-08-27:**

| Open | State |
| --- | --- |
| **J2 touch parity** | not started — the largest real gap |
| **J3 the editor on a phone** | not started |
| **J4 platform chrome** | not started |
| **B2 drag-to-reorder headings** | queued, unspecced |
| **K4 the thumbnail** | mostly done in K1; what remains is cosmetic |

**Mobile is the gap worth naming out loud.** J1 turned "unusable" into
"usable" and J2a fixed the phone header's proportions, but "easy to use" — a
clause of the stated goal — is still not true on a phone. J2 is where the
touch rulings get made, and a wrong ruling there (long-press versus a visible
affordance) is expensive to reverse once every surface has copied it.

**Nothing blocks anything.** B2 and K4 are small enough to slot in anywhere;
J3 depends on nothing but J1; J2's ordering ahead of J3 is a recommendation,
not a dependency.

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

### B2. Drag-to-reorder headings — queued, unspecced

Grab the badge to move a heading and its whole subtree, with a drop indicator.
Split out of B because it is a document mutation with its own coordinate math
and undo semantics, and because jsdom has no `setPointerCapture`, so Playwright
would be its only possible coverage. Ordering relative to C is undecided.

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


## J. Mobile — J1 and J2a SHIPPED 2026-08-26, J2–J4 named and unscheduled

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

### J2. Touch parity — NOT STARTED

**J2a shipped separately on 2026-08-26** — the phone header's proportions and
its 44px targets — and is NOT the whole of J2. Everything below is still open.

Every hover-only affordance and every right-click route needs a touch
equivalent, and tap targets need to reach 44px. The note row's pin shipped
hover-revealed on 2026-08-26 with the row context menu as its non-hover route;
on a phone there is no right-click either, so long-press is the likely answer
and J2 is where that gets ruled on. The fold chevron, the table handles and the
resizer's hit area are in the same position.

### J3. The editor on a phone — NOT STARTED

`visualViewport` and the virtual keyboard, the floating top and bottom
toolbars, selection handles, the code-language popover, tables. The J1
screenshots already show the top control pill overlapping the note title at
390px, which is J3's first item.

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
