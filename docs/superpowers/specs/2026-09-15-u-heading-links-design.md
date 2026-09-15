# U — Heading links: `[[Note/Heading]]` — Design Spec

**Date:** 2026-09-15
**Status:** Draft — awaiting review
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Builds on:** `docs/superpowers/specs/2026-08-31-l2-backlinks-design.md` — L2
shipped `[[title]]`, its index, its pill and its autocomplete. This spec adds
one character to that grammar and nothing to its schema.
**Rulings that govern this work:** `docs/rulings/tag-pills.md` (the link
pill's decorations and activation contract), `docs/rulings/notes-lifecycle.md`
(`AppShell`'s `key={}` and `seed`, `useLiveQuery` gating),
`docs/rulings/markdown-and-schema.md` (a new keyboard binding or input rule),
`docs/rulings/accessibility.md` (the autocomplete's combobox contract),
`docs/rulings/testing-and-tooling.md`

## Summary

`[[Deploy Checklist/Rollback]]` links to a heading inside a note. Typing `/`
after a title in the `[[` popover lists that note's headings; following the
link opens the note, unfolds the section if it was folded, scrolls the heading
near the top and flashes it.

The whole design is shaped by one decision: **headings are not indexed.** The
note half of a link resolves against the known-title set exactly as it does
today; the heading half is resolved once, at the moment you click, against the
document being opened. A heading that has since been renamed or deleted costs
you nothing but the scroll — the link still opens the note.

That choice is what keeps this sub-project out of Dexie entirely. There is no
new table, no version bump, no migration, no sync change, and `reindex.ts`
is not touched.

### Non-goals

- **A heading index.** Rejected above, on purpose. The alternative — a
  `noteHeadings` table beside `noteTags` and `noteLinks` — would let a stale
  heading render as visibly broken, at the cost of a schema version, a rebuild
  on every save, a sync decision, and making a heading rename visibly break
  other notes. The trade was put to the user and declined.
- **Fuzzy heading matching.** A near-miss that lands confidently on the wrong
  heading is worse than landing at the top, because the reader cannot tell
  which just happened.
- **`[[Title#Heading]]`,** Obsidian's delimiter. `#` is this app's tag sigil;
  putting it inside a link invites exactly the confusion the tag grammar spends
  `docs/rulings/tag-grammar.md` avoiding. Bear uses `/`, and so do we.
- **Headings in the backlinks panel or the graph.** Both keep working at note
  granularity: the panel lists notes, the graph keeps one edge per note pair.
  A heading link is a link to the note, drawn once.
- **Any export change.** `[[…]]` is plain text in the ProseMirror document,
  not a mark, so it already serializes literally into Markdown, HTML, PDF and
  a published page. Nothing in `src/features/export/` is touched, and this is
  a property of the existing design rather than a decision taken here.
- **Linking to anything but a heading.** No block links, no line links.

## Decisions made during brainstorming

Four questions were open. All four are settled.

**A link whose heading no longer matches opens the note at the top, quietly.**
The note part is what makes it a link; the heading is a hint about where to
land. Nothing renders as broken, nothing asks to be repaired. The cost,
accepted knowingly: a link can go stale with no sign until you follow it.

**The rendered link shows the whole thing — note, separator, heading.** Two
links to a `Rollback` heading in two different notes must not look identical,
and the reader must be able to proofread the destination without clicking. The
accepted cost is width: a title plus a heading can run a long way into the
40em measure.

**Arriving unfolds the target section and flashes it.** A fold is view state,
not content, so unfolding writes nothing durable; arriving at a collapsed
heading with no content under it reads as a broken link when nothing is wrong.
The flash exists because a long note with six similar headings otherwise makes
you find your own place.

**The note/heading boundary is decided where the known-title set already
lives, and the index stores the raw target.** Two alternatives were considered
and rejected:

- *Split at index time, threading the title set into `reindex`.* Exact by
  construction, but it makes a note's derived rows depend on **other notes
  existing**: creating a note would have to retroactively re-split every
  indexed link that might now resolve differently, and a per-note reindex
  stops being derivable from that note alone. `docs/rulings/tag-index-and-startup.md`
  treats that self-containment as load-bearing. Not worth spending here.
- *Split at the last `/`, always, everywhere.* Purely syntactic and
  impossible for the index and the editor to disagree about — but it makes a
  note titled `A/B testing` permanently unlinkable: `[[A/B testing]]` would
  index as note `A`, heading `B testing`, and render unresolved forever with
  nothing on screen explaining why. Titles containing `/` are ordinary
  (`TCP/IP`, `2026/09/15`).

## Architecture

### The splitter

```ts
// src/data/links/splitLinkTarget.ts
export interface LinkTarget {
  /** Normalized note title — `normalizeTitle`'s output, the index key. */
  title: string;
  /** Normalized heading text, or `null` when the link names no heading. */
  heading: string | null;
  /** Offset within the raw inner text where the heading's `/` sits, or -1. */
  slash: number;
}

export function splitLinkTarget(
  raw: string,
  isKnownTitle: (title: string) => boolean,
): LinkTarget;
```

The rule, in order:

1. Normalize the whole inner string. If it names a known note, return it with
   `heading: null`. **This branch is why `[[A/B testing]]` is a note and never
   a heading link**, and it must stay first.
2. Otherwise walk the `/` boundaries from the right, longest prefix first, and
   return the first prefix that names a known note, with the remainder as the
   heading.
3. Otherwise return the whole string with `heading: null` — byte-for-byte
   today's unresolved behaviour, so an unresolved link is unchanged by this
   sub-project.

**The scan runs over the RAW inner text and normalizes each candidate as it
goes — never over the normalized string.** `normalizeTitle` lowercases and
collapses whitespace, so an offset found in its output does not address the
same character in the raw text, and `slash` would point into the wrong place
the moment a title contained a double space. So: split the raw text at its
own `/` positions, normalize each prefix for the `isKnownTitle` lookup, and
report `slash` as the raw index. `title` and `heading` come back normalized
(they are keys); the pill reads the raw text it already has and uses `slash`
to cut it.

`isKnownTitle` is a predicate rather than a set so every caller feeds what it
already holds: `LinkPill`'s plugin-state `Set`, `buildGraph`'s `byTitle` map,
and `linksTo`'s own lookup. **This is the only place the `/` rule exists.** A
second implementation of it is this project's signature defect and the thing a
reviewer should look for first.

`slash` is returned rather than recomputed by the caller because the pill needs
to decorate three ranges and recomputing the boundary from the normalized
title would be wrong the moment the raw text differs in case or spacing.

### The index does not change

`parseLinks`, `reindexNote` and the `noteLinks` schema are untouched. A link
to `[[Deploy Checklist/Rollback]]` stores `toTitle: 'deploy checklist/rollback'`
verbatim, exactly as it does today.

Two consumers learn to split instead:

- **`notes.linksTo(title)`** adds a prefix query beside its existing exact
  one: `where('toTitle').startsWith(key + '/')`. The `toTitle` index already
  exists and already supports the range. One correctness detail: a prefix hit
  whose full key is **itself a known note title** must be dropped — otherwise
  a note titled `Deploy checklist/rollback` (a real note, linked directly)
  would also show up as a backlink of `Deploy checklist`. Narrow, but exact is
  cheap here.
- **`buildGraph`** splits before its `byTitle.get(key)`. Without this, every
  heading link resolves to nothing and mints its own ghost node, so one real
  note would appear in the graph as several ghosts named after its headings.
  With it, a heading link is an edge to the note, and a heading link to a
  **missing** note makes one ghost for the note rather than one per heading.

### Rendering

`linkDecorations` splits a resolved link's range into three inline
decorations: the note part, the `/`, and the heading. All three sit inside the
one accent run; the `/` carries its own class and paints at `--bear-faint` so
the eye finds the seam without the link reading as two objects.

Resolution is unchanged: `data-resolved` reflects the **note**, and the
heading never makes a link look broken. The `↗` glyph stays where it is, on
the trailing span after the whole thing.

The bracket collapse is unchanged and still applies to resolved links only.

### Following one

`AppShell` renders the editor with `key={selectedNote.id}`, so following a
link to another note **remounts** it. The target editor does not exist at the
moment of the click, so the reveal cannot be an imperative call on
`RichEditorHandle` — it has to arrive as state.

`handleActivateLink` takes the heading alongside the title and stores it beside
`select(id)`, cleared when the selection moves away — the same shape as `seed`,
which already carries a clearing effect for exactly this reason (see
`docs/rulings/notes-lifecycle.md`).

It reaches `RichEditor` as a prop carrying a **nonce**, not a bare string:

```ts
revealHeading?: { text: string; nonce: number };
```

A read-once-at-mount prop, the shape `initialMarkdown` and `autoFocus` use,
would silently do nothing when the link points at **the note you are already
in** — no remount, no new mount, no reveal. The same-note case is the one a
reviewer is least likely to try by hand, so the prop is shaped to make it work
by construction rather than guarded against.

On arrival, in `RichEditor`:

1. `headingSections(doc)` gives every section's `pos`, `text`, `level` and
   `nth`. Match on `normalizeTitle(section.text) === heading`; first match
   wins.
2. Drop every folded key whose section range covers that `pos` — **ancestors
   included**, since a folded h2 hides its h3s and the target heading may be
   hidden by a section two levels up. Iterate until `hiddenRangesFor` reports
   the position visible, then `setHeadingFolds` with what remains.
3. Scroll the heading near the top.
4. Paint a decoration on the heading that clears itself after ~1s.

Nothing durable is written. The fold is left open afterwards, which is the
answer the user chose.

### The autocomplete

Typing `/` after a title that resolves switches the popover from notes to that
note's headings, keeping the leading-glyph row shape the link popover just
gained. The rows carry a heading glyph rather than `FileText`, so the two
modes are told apart the same way the link and tag popovers are.

Headings come from a new `notes.headingsOf(title)`, delivered into the plugin
the way titles already are — a command dispatching a meta-only transaction
carrying `skipTrailingNodeMeta`, exactly as `setKnownNoteTitles` does and for
the identical reason (`TrailingNode`'s `appendTransaction` is not gated on
`docChanged`; see `docs/rulings/markdown-and-schema.md`).

The heading extraction itself lives in `src/data/`, not `src/features/`,
because the data layer may not import from features. It uses the existing
`maskCode`, so a `#` inside a fence is not a heading.

### The risk this design names rather than discovers

This creates **two heading readers**: one over stored Markdown, for the
popover, and one over the live ProseMirror document, for navigation. Two
implementations of one grammar is this project's signature defect.

They cannot be collapsed — they read genuinely different inputs, a note you
have not opened versus the document in front of you, and the second must be
authoritative for what is actually on screen. What keeps them honest:

- both compare through `normalizeTitle`, so the key is shared even though the
  scanners are not;
- a test asserts the two agree across `e2e/fixtures/corpus.ts`'s notes — for
  every corpus note, the Markdown scanner's headings equal the document
  walker's, in order.

If that test is ever deleted or weakened, the two will drift and the symptom
will be a popover offering a heading the navigator cannot find, which presents
as "the link does nothing."

## Testing

What each layer can actually prove, and what it cannot:

- **`splitLinkTarget`** is pure and gets the bulk of the coverage: a title
  containing `/` that resolves whole; a title containing `/` that also has a
  heading; the longest-prefix preference with two candidate prefixes both
  known; nothing known; an empty heading (`[[Title/]]`); leading and trailing
  whitespace around the `/`.
- **`linksTo`** needs a case where the exact and prefix queries both hit, and
  the false-positive case above — a note whose title is another's plus `/`.
- **`buildGraph`** needs the ghost-count assertion: two heading links into one
  missing note make **one** ghost, not two.
- **The pill's three decorations** are unit-testable through the headless
  editor the way `linkPill.test.ts` already tests the existing ones.
- **Following a link** belongs in Playwright, both directions: to another
  note, and within the current note (the nonce case). jsdom cannot scroll and
  has no layout, so the scroll assertion is e2e or nothing.
- **The unfold-on-arrival** needs a folded target section — assert the section
  body is visible afterwards, not merely that the fold key changed.
- **The flash** is a decoration with a timer; assert the class appears and
  then goes, with the clock controlled.

Per `docs/rulings/testing-and-tooling.md`, any test written here that could
pass against a sabotaged implementation is not yet a test — in particular the
reveal, where "the editor scrolled somewhere" must be distinguished from "the
editor scrolled **to that heading**."

## What could go wrong

- **The same-note reveal.** If the nonce is dropped in review as "unnecessary
  indirection", following a heading link inside the current note stops working
  and no unit test will say so.
- **A heading link to a note with two identical headings.** First match wins,
  deliberately: `nth` exists in `FoldKey` but the link grammar carries no
  occurrence number, and inventing one (`[[Note/Heading/2]]`) collides with
  the `/` rule.
- **`linksTo`'s prefix query on a large vault.** It is an index range scan, not
  a table scan, but it is a second round trip on a panel that renders on every
  note switch.
- **A heading containing `/`.** `[[Note/Section A/B]]` resolves to note `Note`
  with heading `Section A/B`, because step 2 takes the longest *title* prefix,
  not the shortest. That is the right answer and it falls out of the rule
  rather than needing a special case — but it deserves a test, because the
  opposite reading is the intuitive one.
