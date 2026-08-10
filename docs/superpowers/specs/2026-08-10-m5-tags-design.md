# M5 — Tags

Status: design approved, not implemented
Parent spec: `docs/superpowers/specs/2026-08-06-bear-web-design.md`

Bear's organizing model is that you type `#work/urgent` inside a note and it
appears in the sidebar. Until this milestone lands, bear-web is a note list;
after it, it is Bear. This is also the milestone that pays the project's largest
outstanding debt: `parseTags` has been a stub returning `[]` since M1, so every
note written during M2–M4 carries an empty tag index.

## Scope

M5 delivers:

- `parseTags`, the real parser, test-driven
- the one-time tag-index rebuild
- the sidebar tag tree, nested, collapsible, with counts
- filtering the note list by a selected tag

**Deferred to M5b:** the tag pill mark in the editor (a Tiptap extension with
its own round-trip contract, which is M4-class work), and tag rename and delete
(destructive multi-note mutations with undo snapshots — a different risk class,
and better built once the parser has survived real use).

**Not in M5:** smart lists. The parent spec's milestone table assigns them to
M6 alongside trash management, and `ScopeSidebar.tsx`'s own comment agrees.
`CLAUDE.md`'s table said "M5 tags, smart lists"; that table is wrong and is
corrected as part of this milestone.

## Module layout

```
src/data/tags/parseTags.ts       the parser — pure, zero imports
src/data/tags/parseTags.test.ts  written first
src/data/migrations.ts           runStartupMigrations()
src/features/tags/tagTree.ts     string[] -> tree, pure
src/features/tags/useTagTree.ts  live query + collapse state
src/features/tags/TagSidebar.tsx
```

The parent spec sketches `features/tags/` as holding the parser as well. **It
cannot.** `parseTags` is injected at `src/data/repositories/index.ts`, and
`src/data/` must not import from `src/features/`. It also genuinely is
data-layer logic: it derives a database index and nothing else. The parser
therefore lives in `src/data/tags/`; the tree builder and the sidebar stay in
features. This is the same class of correction already applied to `src/lib/`.

## The parser

### Why not `marked`

`marked` is already a transitive dependency through `@tiptap/markdown`, and
tokenizing with it would give CommonMark correctness for free. Rejected on two
grounds:

1. `parseTags` runs inside a Dexie transaction on **every save**, and across
   **every note** during a rebuild. Full Markdown tokenization is the wrong
   cost for that call site.
2. `src/data/` importing the editor's Markdown library is exactly the coupling
   the sole-importer rule in `CLAUDE.md` exists to prevent.

The accepted risk is that we hand-roll a subset of CommonMark. It is mitigated
by the spec's standing requirement that `parseTags` be developed test-first.

### The precedence rule

> A tag may only start at a `#` preceded by start-of-line or whitespace.

This one precondition removes any need to detect URLs, link destinations, or
HTML attributes:

| input                 | why it is not a tag |
| --------------------- | ------------------- |
| `https://ex.com/#a`   | `/` precedes        |
| `[x](#anchor)`        | `(` precedes        |
| `<div id="#x">`       | `"` precedes        |
| `a#b`                 | `a` precedes        |

### Masking

Only two constructs need masking before the scan: **fenced code blocks** and
**inline code spans**.

- Fenced: opening run of three or more `` ` `` or `~`; the closing fence must
  use the same character and be at least as long.
- Inline: a backtick run is closed by a run of exactly equal length, per
  CommonMark.

**Indented code blocks are deliberately not masked.** CommonMark's rules for
when a four-space indent is code rather than list continuation are the hairiest
part of the specification, and the payoff is thin — the obvious cases reject on
their own grammar:

- `# install deps` — space after `#`, empty tag, rejected
- `#!/bin/sh` — `!` trimmed as trailing punctuation, empty tag, rejected

The genuine miss is `#define FOO` inside indented C, which produces one junk
tag named `define`. The cost is a spurious sidebar row that the user can edit
away, and it is preferred to hand-rolling list-aware indentation tracking.

Raw HTML blocks are likewise not masked. A `#work` inside an HTML comment is
indexed. This is a documented ruling, not an oversight: it is at least as
likely to be intentional as not.

### Grammar

Applied to the surviving text, left to right. At each `#` that satisfies the
precedence rule:

1. If the next character is whitespace or end-of-line, reject and continue.
2. **Multi-word form.** Scan forward on the same line to the next `#`. If one
   exists and is immediately followed by whitespace or end-of-line, the span
   between the two hashes is the tag content. If the next `#` is followed by
   anything else, there is no valid closing hash and the multi-word form does
   not apply.
3. **Simple form.** Otherwise the content runs to the next whitespace or
   end-of-line. Content containing a `#` is rejected.
4. Collapse internal whitespace runs to a single space, then trim.
5. Trim trailing `.,;:!?` repeatedly, so `#done..` yields `done`, then trim
   trailing `/`, so `#work/` yields `work` rather than a tag with a phantom
   empty child.
6. Lowercase with `toLowerCase()`, not `toLocaleLowerCase()` — a Turkish
   locale must not turn `I` into `ı` and split a tag.
7. Reject if the content is empty, if any `/`-separated segment is empty
   (`#a//b`), or if **every** segment is numeric.

Splitting on `/` is a display concern. The stored key is the whole string:
`work/urgent`, not `work` and `urgent`.

Rule 2 is what makes the multi-word form safe. Worked cases:

| input             | tags            | why                                        |
| ----------------- | --------------- | ------------------------------------------ |
| `#a #b`           | `a`, `b`        | next `#` is followed by `b`, not whitespace |
| `#project plan#`  | `project plan`  | closing `#` at end of line                 |
| `#a b #c d#`      | `a`, `c d`      | first candidate has no valid close         |
| `# Heading`       | —               | whitespace after `#`                       |
| `## Heading`      | —               | valid close, empty content                 |
| `### Heading`     | —               | no valid close; simple content holds `#`   |
| `#1 priority`     | —               | every segment numeric                      |
| `#404`            | —               | every segment numeric                      |
| `#work/1`         | `work/1`        | not every segment numeric                  |
| `#done.`          | `done`          | trailing punctuation trimmed               |
| `#한국어`         | `한국어`        | no character-class restriction             |
| `` `#code` ``     | —               | inline code span, masked                   |

Note that `#tag` at the start of a line is a tag, not a heading: CommonMark
requires a space after the `#` for ATX headings, so the two never collide.

### Case

`#Work`, `#work` and `#WORK` are one tag, keyed and displayed lowercase. Note
text is never rewritten.

The alternative Bear uses — case-insensitive matching with first-seen casing
preserved for display — was rejected because "first" is undefined during a
rebuild. `rebuildTagIndex` visits notes in whatever order the store returns,
so display casing could flip on rebuild, violating the parent spec's rule that
dropping and rebuilding the index is always safe. Lowercasing makes the rebuild
byte-deterministic by construction.

## The rebuild

`runStartupMigrations()` reads a `tagIndexVersion` key from `settings`. If it is
behind the current version, it awaits `notes.rebuildTagIndex()` and writes the
new number. It runs at application start, outside React.

A throw is caught and logged. The result is an empty index and a working app.

The rejected alternative was a Dexie `version(2).upgrade()` hook. `db.ts` even
carries a commented template for it. It was rejected because a throw inside a
versioning transaction means the database never opens: the app is bricked with
the user's notes on disk and unreachable. A settings marker also re-runs
cleanly — M5b and M6 will both change the parser, and each change needs only a
bumped number.

### Import

`importBackup` currently restores the bundle's `noteTags` rows verbatim. It
will instead ignore them and call `rebuildTagIndex()` inside its existing
transaction.

`noteTags` is derived data; trusting a file's copy of it contradicts the rule
that the index comes from `notes.text` and is never authoritative. It also
fixes importing any backup taken before M5, which would otherwise restore an
empty index. No format bump: export still writes the rows and v1 bundles still
validate.

## Scope and filtering

```ts
export type NoteScope =
  | { kind: 'active' }
  | { kind: 'trashed' }
  | { kind: 'tag'; tag: string };
```

**This union carries a trap.** `useNotes` passes `[scope]` as a `useLiveQuery`
dependency array. An object literal has a new identity every render, so the
query would refetch forever. Every scope-dependent hook keys on a serialized
`scopeKey` string — `'active'`, `'trashed'`, `'tag:work/urgent'` — used both as
the dependency and as the tag in the tag-and-verify pattern that `CLAUDE.md`
already mandates for any `useLiveQuery` with changing dependencies.

`listForScope` gains a tag branch. Selecting `#work` includes `#work/urgent`:
parent selection covering descendants is the entire point of nesting. Two
queries against the existing `tag` index — `.equals(tag)` and
`.startsWith(tag + '/')` — union the note ids, fetch the notes, drop trashed
ones, sort by `updatedAt` descending. Including the `/` in the prefix is what
stops `#work` from matching `workflow`.

### Editing a note out of scope

A note edited so that it no longer carries the selected tag disappears from the
list but **stays open in the editor**. Nothing may steal the caret mid-sentence,
and typing `#wo` on the way to `#work` must not close the note.

The reconciliation effect in `useNotes` therefore narrows to trash state alone:

- `kind === 'trashed'` — deselect if `trashedAt === null`
- `active` or `tag` — deselect if `trashedAt !== null`

Tag membership never deselects.

## Sidebar

`ScopeSidebar` survives M5 unchanged, still two hardcoded rows, still slated for
deletion in M6. `TagSidebar` renders beneath it and calls the same
`onScopeChange`. M6 merges the two.

`useTagTree` live-queries the distinct tags in `noteTags` and builds a tree by
splitting each on `/`. A parent node appears whenever any child exists, whether
or not the parent is itself used on a note. Collapse state comes from the
existing `tags` table via `tags.setCollapsed`, which is already implemented and
unused. Each node shows a note count; the rows are already loaded, so it costs
nothing.

## Testing

`parseTags` gets an exhaustive table-driven suite, written before the
implementation: every grammar rule, both masking rules, the precedence rule,
Korean input, and every negative case in the table above.

Beyond that:

- **Rebuild determinism.** Rebuilding twice, and rebuilding after shuffling
  note insertion order, must produce identical row sets. This is the property
  the lowercase decision exists to guarantee, so it is asserted rather than
  assumed.
- **Migration.** The marker is respected; a bumped version re-runs; a throwing
  parser leaves the app usable with an empty index.
- **Import.** A bundle whose `noteTags` rows are wrong or absent still yields a
  correct index.
- **`listForScope`.** Descendants included, `workflow` excluded when `work` is
  selected, trashed notes excluded.
- **`useNotes`.** No refetch loop on a stable scope; stale-tag fallback on
  switch; a note edited out of tag scope stays open.
- **e2e.** Type `#work/urgent` into a note, see both nodes appear in the
  sidebar, click the parent, and watch the list filter to it.

## Carried forward

- The tag pill mark and rename/delete move to M5b.
- Indented code blocks and raw HTML blocks are unmasked, by ruling.
- `usePaneWidths`' unflushed writes remain open from M3.
