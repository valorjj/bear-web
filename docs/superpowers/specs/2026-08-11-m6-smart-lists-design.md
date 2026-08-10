# M6 — Smart lists and trash management

Status: design approved, not implemented
Parent spec: `docs/superpowers/specs/2026-08-06-bear-web-design.md`
Predecessor: `docs/superpowers/specs/2026-08-10-m5-tags-design.md`

M5 made the sidebar real for tags. M6 makes the rest of it real: the smart-list
rows that sit above the tag tree, and the trash operations that until now have
existed in the repository with no way to reach them. It also pays two debts the
project has been carrying since M3 — `ScopeSidebar.tsx`, which was always meant
to be deleted here, and `setPinned`, which has had **zero callers** since M1.

## Scope

M6 delivers:

- every row in the parent spec's smart-list table, plus Locked in its permanent
  empty state
- pinning: a toggle, and pinned-first ordering in every non-trash list
- trash management: Delete Forever, Empty Trash, and a `ConfirmDialog` primitive
- the startup sweep of never-saved blank notes
- deletion of `src/features/notes/ScopeSidebar.tsx`

**Not in M6:** search (M7), the theme picker (M8), tag rename and delete and the
tag pill mark (M5b), and real encryption behind the Locked row (Phase 2).

**Depends on M5.5** (`docs/superpowers/specs/2026-08-11-m5-5-design-language.md`),
which lands first. M6 consumes three things from it: `Button`'s `danger` variant
for Delete Forever, its `disabled` state for Empty Trash on an empty bin, and the
`SidebarRow` primitive that the smart-list rows share with the M5 tag tree. The
`--shadow-dialog` and motion tokens `ConfirmDialog` needs come from there too.
Building M6 first would mean writing the smart-list row, then extracting it into
`SidebarRow` immediately afterwards.

## Module layout

```
src/features/notes/smartLists.ts       predicates + the row registry, pure
src/features/notes/smartLists.test.ts
src/features/notes/SmartListSidebar.tsx
src/features/notes/useSmartListCounts.ts
src/features/notes/scope.ts            rewritten: two arms, named predicates
src/data/sweep.ts                      the startup sweep
src/ui/ConfirmDialog.tsx
```

`ScopeSidebar.tsx` and its test are deleted.

## The scope union

### The rule this milestone is shaped by

CLAUDE.md records what happened when `NoteScope` last grew:

> Widening a two-armed union to three is not a safe default when logic is gated
> with `===`. `NoteList`'s Trash button stayed gated on `scope.kind === 'active'`,
> which was total over the old two scopes and silently became partial — a tag
> scope rendered neither Trash nor Restore, so a note filtered to `#work` had no
> delete affordance at all.

M6 takes the union from three arms to eight. Enumerating arms at call sites does
not survive that, and "gate the total case rather than the arms that should pass"
only defers the problem — `!== 'trashed'` is total today and stops being total
the moment Locked arrives, because Locked must render no Trash button either.

So the arms stop being the thing call sites read.

### Shape

```ts
export type SmartListId = 'all' | 'untagged' | 'todo' | 'today' | 'pinned' | 'locked' | 'trash';

export type NoteScope = { kind: 'smart'; list: SmartListId } | { kind: 'tag'; tag: string };
```

Two arms, permanently. A new smart list is a new `SmartListId`, which is a new
entry in one table — not a new arm, and not a new `===` site anywhere.

`scopeKey` yields `smart:all` or `tag:work`. The `tag:` prefix still exists for
the reason M5 gave: a tag literally named `all` must not collide with the
builtin. `ACTIVE_SCOPE` and `TRASHED_SCOPE` keep their names and stay module
constants, because `useNotes` still puts the scope through a `useLiveQuery`
dependency array and an object literal has fresh identity every render.

### Named capabilities, not `kind` comparisons

Every behavioural question about a scope becomes a function in `scope.ts`:

| Function              | Answers                                                     |
| --------------------- | ----------------------------------------------------------- |
| `isTrash(scope)`      | Restore instead of Trash; Delete Forever and Empty Trash render |
| `allowsTrash(scope)`  | the Trash button renders at all — false for `trash` and `locked` |
| `seedTagFor(scope)`   | the tag a new note is seeded with, or `null`                 |
| `acceptsNewNote(scope)` | whether a note created here would be visible here          |

A call site asking "should I render Restore?" reads `isTrash(scope)`. It never
reads `scope.kind`, and it never reads `scope.list`. Adding a smart list means
extending the table in `smartLists.ts`; the functions above are total over
`SmartListId` by construction because they read that table.

**`acceptsNewNote` generalizes today's trashed-scope bounce.** `handleCreate`
already switches to All Notes when the scope is `trashed`. The same problem
arrives with `pinned`, `todo` and `locked`: a brand-new note is not pinned, has
no todo, and is not locked, so creating one there produces a note that vanishes
the instant it is made.

Accepting: `all`; `untagged`, because a new note genuinely has no tags; `today`,
because a new note's `updatedAt` is by definition today; and any `tag` scope,
because the note is seeded with that tag. Bouncing to All Notes before creating:
`pinned`, `todo`, `locked`, `trash`.

Note that `untagged` and `today` accept for opposite reasons — `untagged` because
the note satisfies its predicate now, `today` because it satisfies it now and
will stop later. Neither is a special case; both fall out of asking whether the
predicate holds at the moment of creation, which is what the function computes.

## Smart lists

### The rows

Per the parent spec, plus All Notes:

| Row       | `SmartListId` | Predicate                                     |
| --------- | ------------- | --------------------------------------------- |
| Notes     | `all`         | every active note                             |
| Untagged  | `untagged`    | active note with no rows in the tag index      |
| Todo      | `todo`        | active note whose text contains an unchecked task |
| Today     | `today`       | active note whose `updatedAt` is on the current local date |
| Pinned    | `pinned`      | active note with `pinned === true`             |
| Locked    | `locked`      | nothing, permanently                           |
| Trash     | `trash`       | `trashedAt !== null`                           |

All rows except Trash exclude trashed notes. Order in the sidebar follows the
table.

### Predicates are pure, and take what they need

The parent spec calls these "pure predicates over a note". Two of them are not
functions of a note alone, and pretending otherwise is how they end up wrong:

```ts
export interface PredicateContext {
  /** Note ids carrying at least one tag, from the index — not from a parser. */
  tagged: ReadonlySet<string>;
  /** Injected, so `today` is testable without touching the system clock. */
  now: number;
}
```

Every predicate has the shape `(note: Note, ctx: PredicateContext) => boolean`.
Predicates that ignore the context simply ignore it; the signature stays uniform
so the registry can hold them in one table.

### Untagged reads the index, never a parser

`notes.allTagRows()` already exists as the sidebar's door to the tag index.
Untagged is the complement of the note ids appearing in it. Feature code does
not acquire a second call site for `parseTags` — that would be a second source
of truth for tag membership, and `src/features/` importing `src/data/tags/`
directly would violate the boundary that put the parser in the data layer.

This is correct-by-construction for trashing, too: the index reflects active
notes only, so a trashed note contributes nothing to `tagged`, and Untagged
already excludes trashed notes by its own filter.

### Todo must be pinned against the real serializer

The parent spec writes the predicate as "body contains an unchecked `- [ ]`".
That string is an assumption about our own output, and it is the kind of
assumption that ships inert with a green suite — exactly the failure mode
CLAUDE.md records for the underline mark, where the rule was asserted
everywhere except the one place that decided it.

`src/features/editor/markdown.ts` is the authority on what a task item
serializes to. The predicate's tests **must** derive their fixture by running a
task list through `MarkdownManager`, not by typing `- [ ]` into a test file. If
the serializer emits `* [ ]`, a hand-written fixture passes and every real note
fails.

The predicate matches an unchecked task at the start of a line, allowing leading
whitespace for nesting, and must not match a checked one. It is a plain regex
over `note.text`; it does not parse the document.

### Today is local, and does not roll over

"`updatedAt` falls on the current local date" means local midnight to local
midnight, computed from the injected `now`, not a 24-hour window and not UTC.

**Known limit, accepted:** the list does not re-render when the clock crosses
midnight. A note edited at 23:59 stays in Today until something else causes the
query to re-run. Fixing it means a timer that fires at midnight, which is a live
subscription whose only purpose is to move one row — not worth it, and it is
recorded here so it is not rediscovered as a bug.

### Locked

The row renders and is selectable. Selecting it shows a permanent empty state
whose copy says encryption is not built yet, not "no notes found" — a user who
sees the latter concludes their locked notes were lost. `allowsTrash` is false
for it and `acceptsNewNote` is false for it, so it renders no destructive or
creative affordance at all.

### Counts come from one query, not seven

Each sidebar row shows a count. The obvious implementation is one `useLiveQuery`
per row, and it is wrong for a reason M5 already paid for: the tag tree's row
count and its children resolve as two independent live queries, which is why a
collapsed row can flash open for a frame.

`useSmartListCounts` is a single `useLiveQuery` performing one `listActive()`
and one `allTagRows()`, and deriving all seven counts from that one snapshot.
Every row updates in the same commit, and the counts are mutually consistent —
Untagged plus tagged always equals All, which is not guaranteed when seven
queries land in seven different frames.

Its deps are the constant `[]`, so the tag-and-verify pattern does **not** apply
to it, for the same reason it does not apply to `usePaneWidths`.

**Known cost, accepted:** `listForScope` performs its own `listActive()`, so a
smart-list scope scans the notes table twice — once for the list, once for the
counts. Joining them would mean `listForScope` returning counts it has no other
reason to know, coupling the note list to the sidebar. At this app's scale the
second scan is not measurable; if it ever is, the fix is a shared query hook,
not a widened `listForScope` signature.

## Pinning

`setPinned` has existed and been tested since M1 and has never been called. The
Pinned row is unreachable without a way to pin, so pinning is not scope creep
here — it is what makes one of the required rows non-empty.

**A pin toggle on the note list row.** It is an affordance on the row rather
than in the header toolbar because pinning targets a specific note, and Bear
puts it there.

**Pinned notes sort first in every non-trash list.** Not only in the Pinned
row — this is what pinning means in Bear, and a "pinned" note that sits in the
middle of All Notes is not pinned to anything. `listActive` and `listByTag` both
change their comparator to pinned-first, then `updatedAt` descending. `listTrashed`
does not: trash is ordered by when it was trashed, and a pinned note that was
deleted is not more important than one deleted later.

`pinned` remains unindexed and filtered in memory. IndexedDB cannot index
booleans; `.where('pinned')` throws at runtime, not compile time.

## Trash management

### Operations

Both repository methods already exist, are transactional, and are tested.
M6 supplies the UI and the confirmation.

- **Delete Forever** — `notes.purge(id)`, on the selected note, only in Trash.
- **Empty Trash** — `notes.emptyTrash()`, only in Trash, disabled when empty.

### ConfirmDialog

These destroy notes with no server copy and no undo. `window.confirm` was
rejected: it ignores the theme entirely, and some embedded contexts suppress it
silently — a suppressed confirm means the delete simply happens with no prompt
at all. An undo toast was rejected as more work than a dialog, since it needs
both a toast primitive and somewhere to hold purged rows.

`src/ui/ConfirmDialog.tsx` is a presentation primitive and obeys `src/ui/`'s
boundary: it imports nothing from `src/app/`, `src/data/` or `src/i18n/`. Its
copy arrives as props, already translated by the caller — the same reason
`Resizer` takes `min`/`max` rather than importing the pane constants.

It provides: a focus trap, initial focus on the cancel action, Escape to cancel,
a labelled backdrop that cancels on click, and `role="alertdialog"` with
`aria-modal`. The destructive action uses `Button`'s `danger` variant, which
resolves to `--bear-danger`; no literal colour, and no `accent` reference either
— a theme must be able to keep a green accent and a red delete.

**Known limit:** the focus trap is a keydown-cycling implementation, not
`inert`. jsdom supports enough of this to test tab order and Escape; anything
depending on real focus behaviour across the backdrop belongs in Playwright.

### Delete always trashes

**Ruling.** The Delete button trashes every note, blank or not. Today it purges
a blank note outright, which means one button is recoverable or not depending on
state the user cannot see.

This does not fill Trash with `Untitled` rows: `NoteEditor`'s unmount discard
already reclaims a blank note when the selection moves away, so a blank note
reaching the Delete button at all is one the user deliberately deleted. The
discard path is unchanged — only the button changes.

### The startup sweep

A blank note open across a reload is never discarded, because `beforeunload`
flushes but does not unmount. It survives as a permanent `Untitled` row.

`src/data/sweep.ts` purges, at startup, every note satisfying **all three** of:

- `text` is empty
- `trashedAt === null`
- `createdAt === updatedAt`

**The third gate is the entire safety argument, and it is not redundant.** The
sweep runs before any editor has mounted, over notes it has never read — the
same shape as the M4 defect where a truncation reached `notes.purge`. Emptiness
alone is one check with no second guard. `createdAt === updatedAt` means the note
has never been through `save` even once, because `save` always writes a fresh
`updatedAt`. A note the user has typed into is therefore unreachable by the sweep
even if the emptiness check is wrong. Two independent conditions must both fail
to lose data, which is the standard M4 established for deletion paths.

It runs alongside `runStartupMigrations` in `main.tsx`, unawaited, and like both
its neighbours it **never rejects** — including when a caller-supplied `onError`
itself throws. A sweep that fails costs a stray `Untitled` row and retries next
launch.

**Ordering:** the sweep runs after the tag-index rebuild resolves, not
concurrently with it. Both write inside transactions over `notes` and `noteTags`;
sequencing them removes the question of what a rebuild sees mid-purge.

## Testing

| Area                | Where                                                       |
| ------------------- | ----------------------------------------------------------- |
| Predicates          | `smartLists.test.ts`, pure, with an injected `now`           |
| Todo fixture        | derived from `MarkdownManager`, never hand-written           |
| Scope capabilities  | `scope.test.ts`, asserted **exhaustively over `SmartListId`** |
| Counts consistency  | `useSmartListCounts` — untagged + tagged === all             |
| Sweep gates         | `sweep.test.ts`, each of the three gates falsified separately |
| Dialog              | focus trap, Escape, backdrop, cancel-focused-first            |
| Pinned ordering     | `listActive` and `listByTag`; `listTrashed` asserted unaffected |

### Exhaustiveness is the load-bearing test

`scope.test.ts` iterates a `SmartListId[]` and asserts each capability function
for every id. A new smart list added without a ruling on its capabilities must
fail the suite, not silently inherit a default. This is the assertion that would
have caught the M5 defect, and it is the reason the union was reshaped.

### Falsification

Per project practice, each of these must be shown to fail when broken:

- Remove the `createdAt === updatedAt` gate → a sweep test reddens.
- Hand-write the Todo fixture as `- [ ]` → if that is not what the serializer
  emits, the derived-fixture test reddens and the hand-written one does not.
  Both must exist for this to be visible.
- Gate a button on `scope.kind` instead of a capability function → the
  exhaustive scope test reddens.
- Make Locked return notes → its empty-state test reddens.

## Deferred, with rulings

- **Real encryption behind Locked** — Phase 2. Needs WebCrypto, passphrase UX,
  and a recovery story.
- **Which smart lists are visible** — Bear lets you hide rows in preferences.
  All seven always render. Belongs with M8's preferences panel, not here.
- **Auto-emptying trash after N days** — Bear does not do this by default, and a
  timer that deletes notes is a poor fit for an app with no server copy.
- **Midnight rollover for Today** — see above.
- **Undo for Delete Forever** — the dialog is the mitigation. A real undo needs
  the toast primitive and a holding area for purged rows.
