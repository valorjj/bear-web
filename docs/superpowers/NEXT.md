# Next up

Written 2026-08-20, immediately after M8 + M9a shipped to `main` (`c4c3c64`,
CI and Deploy both green). This file exists so a fresh session can resume
without re-deriving decisions already made. Delete a section once its
sub-project has a real spec in `docs/superpowers/specs/`.

## Where things stand

- `main` carries M8 (export, tables, chrome) and M9a (five themes, picker,
  contrast harness, spacing and type scales, Soft Depth). Live on Pages.
- 1143 unit tests, 58 end-to-end. All six gates green.
- `m8-visual-and-export` is merged and can be deleted whenever.

## The three sub-projects, in order

Chosen from four Bear screenshots the user supplied. All three are
**architectural** — each gets its own spec, plan, and implementation cycle.
Order is A → B → C, and the reasoning matters more than the order:

### A. Note-list header

A header naming the current scope, with a dropdown carrying **sort order** and
**preview style**. Bear's version also lists every scope with `⌥⌘1`–`⌥⌘0`
shortcuts.

- **The header itself is trivial; the dropdown's contents are not.** Ordering is
  hardcoded `byPinnedThenRecent` in `src/data/repositories/notes.ts` (Trash
  sorts by `trashedAt`), so a user-chosen sort changes a data-layer contract and
  needs a durable preference.
- **Preview style** touches `NoteListItem`, which has a pinned `aria-label`
  contract and a deliberately reserved two-line snippet height
  (`min-h-[2.0625rem]`). Both are load-bearing; see CLAUDE.md.
- **Open question, not yet decided:** whether the scope list belongs in the
  dropdown at all. Bear can collapse its sidebar, so that menu is sometimes the
  only route to a scope. Ours is always visible, which may make it redundant.
- First because it is the least entangled, and because its parts can be cut
  freely — drop sort or preview style and the header still stands alone.

### B. Collapsible headings + level badge

A gutter chevron that folds a section, plus a `≡N` badge left of each heading,
outside the measure. Clicking the badge opens 머리말 1–6 with `⌘1`–`⌘6` and a
check on the current level, then toggle fold, collapse all, expand all.

- This is the sub-project M9a's spec named **M9c**.
- A new editor subsystem: gutter widgets outside the measure, fold state that is
  **not** in the document, and interaction with `TagPill`'s existing decoration
  plugin.
- Second because it is the highest-value item for the long, heading-dense notes
  this user actually writes, and it is self-contained in the editor.

### C. Code block language + syntax highlighting

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

## Cut, with a reason

- **"여기로 링크 복사" (copy link to here)**, from Bear's heading dropdown. It
  needs per-note and per-heading URLs, and this app has no routing at all — no
  history, no deep links. That is a fourth sub-project wearing a menu item's
  clothing.
- **M9b callout blocks.** Specced in M9a's decomposition and deliberately not
  chosen this round. Still unblocked and still worth doing.

## The item that is still missing from the goal

**Image storage.** The stated goal is "lightweight, fast, beautiful, easy to
use, markdown, **image storage**", and no milestone has ever scheduled it.
Blobs in IndexedDB, an image node in the editor schema, Markdown round-trip,
embedding in HTML and PDF export, backup and import, and a story for eviction
and quota. Bigger than A, B and C together; none of them block it.
