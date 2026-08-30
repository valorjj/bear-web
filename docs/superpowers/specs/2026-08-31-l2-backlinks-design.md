# L2 — Backlinks

Written 2026-08-31. The second of the L-series, after L1 (code copy button,
image quota meter). Named in the roadmap triage of 2026-08-31 as the highest
value for the lowest risk, and the prerequisite for L3's relationship graph.

## Purpose

A note can be found today by tag, by smart list, or by search. It cannot be
reached from another note, and nothing records that two notes are about the
same thing. L2 adds one capability — **a link from one note to another, and the
reverse list of what links here** — and it is the feature that makes a pile of
notes into a body of work.

## Why this is cheap HERE, specifically

Not because every notes app has backlinks. Because the dangerous half is
already built, tested, and ruled on:

- **The index shape exists.** `noteTags` is `'[noteId+tag], noteId, tag'` — a
  compound-key join table indexed in both directions, so both "tags of this
  note" and "notes with this tag" are single-index queries. A link table is the
  same shape.
- **The derivation path exists and is deliberately singular.** `reindexNote`
  is shared by create, save, restore AND the sync engine's apply path,
  precisely so a note's derived rows can only ever be produced by one piece of
  logic. `src/data/reindex.ts` says why: the tag index has already disagreed
  with its own rebuild once in this project's history. Links go through the
  same door.
- **The startup rebuild exists.** `TAG_INDEX_VERSION` plus the migration hook
  in `src/data/migrations.ts` already establish the pattern for a derived index
  that is rebuilt when its deriving logic changes.
- **The inline decoration exists.** `TagPill.ts` renders `#tag` as a pill,
  handles activation, and is masked inside code fences.

## Decisions already taken

### The syntax is `[[Note title]]`

Chosen over `[text](note:id)` because a note's Markdown must stay portable: a
`[[…]]` that reaches another tool is inert text, where a `note:` URL scheme is
a dead link. It also round-trips through this app's Markdown pipeline as plain
text with no schema change, exactly as `#tag` does.

**No alias form (`[[Title|shown text]]`) in L2.** It doubles the grammar and
its absence is not felt until a link's title is long, which the panel and the
pill both truncate anyway.

### A link resolves by TITLE, and fails open

The index stores the normalized target **title**, not a note id. Three reasons,
and the third is the one that decides it:

1. A link may name a note that does not exist yet — an id cannot represent
   that, and writing the link before the note is a normal way to work.
2. It survives export and re-import, where ids do not.
3. **It matches the fail-open rule the tag index already runs on.** A link that
   resolves to nothing is inert and visible, never an error and never a
   dangling pointer. Renaming a note breaks links to it, which is the accepted
   cost — the same cost B1's fold keys pay for being content-derived, and for
   the same reason: content-derived identity fails in the direction the user
   can see and repair.

Normalization is case-insensitive and collapses runs of whitespace. Where two
notes share a title, the most recently updated one wins, and the pill says so
by carrying no special state — an ambiguity the user can only fix by renaming.

### Links are masked inside code, and that masker is shared, not copied

`[[x]]` inside a fenced code block is code, not a link. `parseTags.ts` already
solves this with `maskCode`/`maskInlineCode` and a `\u0000` mask character,
under a set of rulings bought by real bugs — an unclosed fence silently
deleting every tag after it, a closer with an info string inverting fence
state.

**`maskCode`, `maskInlineCode` and `MASK` move to `src/data/markdown/mask.ts`,
and both parsers import them.** A second copy of "how code is masked" is
exactly the duplicated grammar this project forbids, and it would drift the
first time one of those fence rulings was revised. The move is behaviour-
preserving and `parseTags.test.ts` — which pins every one of those rules — is
what proves it.

### The index is `noteLinks`, derived and never synced

`noteLinks: '[noteId+toTitle], noteId, toTitle'`. (This spec said `fromId`
until after L2 shipped; the field is `noteId`, matching `noteTags`' own key
name, and `src/data/db.ts`'s `version(5)` is the authority.) Derived from note
text, so
it is rebuilt rather than transferred — the same treatment `noteTags` gets in
`sync.md`'s rulings. `reindexNote` writes both tables in one place.

A note never links to itself in the index: a self-link is dropped at write
time, because a "linked from" list containing the note you are reading is
noise, not information.

### Activation is `Mod`-click, matching the tag pill

Inside a `contenteditable`, a plain click must keep placing the caret — the tag
pill's ruling, and it applies unchanged here. `Mod`-click opens the target.
This is not the only route: the backlinks panel is plain-click, and it is the
one a person discovers first.

### The backlinks panel

A section beneath the note's content listing every note that links here,
newest first, each row plain-click to open. Hidden entirely when empty,
because an always-present empty section on every note is chrome that never
earns its space.

**Correction (Task 7, 2026-08-31): it shipped always-expanded, not
collapsible.** `BacklinksPanel.tsx`'s `<nav>` carries `max-h-48
overflow-y-auto`, so a note with many backlinks scrolls inside a bounded box
rather than growing the pane without limit — judged sufficient by both the
implementer and the task review, and there is no persisted expand/collapse
state interface anywhere in the app to hang a real toggle off of. See
`docs/rulings/deferred.md`'s L2 section for the full reasoning. This
paragraph describes what shipped; a future task can still add the toggle if
a long backlinks list turns out to want one.

### Autocomplete on `[[`

Typing `[[` opens a filtered list of note titles; Enter or click completes it.
Without this, a link requires remembering an exact title, which fails the
"easy to use" goal the whole L-series serves. Prefix and substring matching
only, capped at 8 rows — no fuzzy ranking, which is a tuning problem with no
end.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/data/markdown/mask.ts` | `MASK`, `maskCode`, `maskInlineCode` — moved verbatim from `parseTags.ts` |
| `src/data/links/parseLinks.ts` | `parseLinks(markdown): string[]`, `findLinkRanges(markdown)`, `normalizeTitle(raw)` |
| `src/data/db.ts` | `noteLinks` store, a new Dexie version, `LINK_INDEX_VERSION` |
| `src/data/reindex.ts` | writes `noteLinks` alongside `noteTags`, in the same transaction |
| `src/data/repositories/notes.ts` | `linksTo(title)`, `rebuildLinkIndex()` |
| `src/features/editor/LinkPill.ts` | the inline decoration and `Mod`-click activation |
| `src/features/notes/BacklinksPanel.tsx` | the reverse list beneath the editor |
| `src/features/editor/LinkAutocomplete.ts` | the `[[` completion widget |

## Testing

- `parseLinks.test.ts` mirrors `parseTags.test.ts`'s hostile fixtures: a link
  inside a fence, inside inline code, an unclosed fence, a fence closer
  carrying an info string, and `[[` with no closer.
- A **shared-masker test** asserting `parseTags` and `parseLinks` agree about
  what is code, against one fixture — the thing a copied masker would break.
- `reindex.test.ts` asserts both tables are written, and that a self-link is
  absent.
- A rebuild test asserting `rebuildLinkIndex` and the incremental path produce
  identical rows for the same corpus. This is the assertion whose absence let
  the tag index disagree with its own rebuild.
- Playwright (`e2e/backlinks.spec.ts`): `Mod`-click navigates, plain click does
  not (it places the caret); the panel lists a linking note and opens it;
  autocomplete completes a title; a link inside a fenced code block is inert.

## Out of scope

- **The relationship graph** — L3, and a rendering of this index.
- **Alias links, heading anchors (`[[Note#Heading]]`), block references.**
- **Renaming a note updating links to it.** Fail-open is the ruling; a rename
  cascade is a write across every note and needs its own design.
- **Unlinked mentions** ("notes containing this title but not linking to it").
  Search already answers that question.
