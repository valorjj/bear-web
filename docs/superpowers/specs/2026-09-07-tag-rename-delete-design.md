# S1 — Tag rename and delete — Design Spec

**Date:** 2026-09-07
**Status:** Draft — awaiting review
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Rulings that govern this work:** `docs/rulings/tag-grammar.md`,
`docs/rulings/tag-index-and-startup.md`, `docs/rulings/accessibility.md`,
`docs/rulings/scopes-and-search.md`

## Summary

A tag can be renamed and deleted from a right-click menu on its sidebar row.
Both operate on the whole subtree, both rewrite the Markdown of every note
carrying the tag, and both are confirmed with real counts before anything is
written.

Today there is no way to remove a tag at all. Right-clicking a tag row
produces the BROWSER's context menu, because nothing in the app handles
`contextmenu` on `SidebarRow` — so the gesture a user reaches for lands on
Chrome's own menu instead of ours.

The user's framing was "if you delete the source, the tag goes with it — no
orphans." That is already true per note: `save`, `trash`, `purge`,
`emptyTrash` and `restore` all maintain `noteTags` in the same transaction as
the note, and the sidebar builds only from `noteTags`. What is missing is the
deliberate operation — removing a tag the user no longer wants, across every
note at once.

### Non-goals

- **Pinning a tag and the icon picker** (Bear's 태그 고정 / the icon grid).
  `TagMeta` already carries `iconKey` and `sortOrder`, already synced, with no
  UI reading either. That makes it wiring, not schema, and it is sub-project
  S3.
- **"Use as workspace"** (Bear's 워크스페이스로 사용). A scoping concept of its
  own, not a tag operation; it belongs with `scopes-and-search.md`, not here.
- **Deferring when a tag is committed while typing** (so `#a` and `#a/b` never
  materialise on the way to `#a/b/c/d`). Designed and agreed separately as
  sub-project S2: hold the autosave while the caret sits inside a tag token,
  with a ~4s cap. Independent of this work.
- **Cross-note undo.** See the decision below.
- **Merging by drag** in the tag tree. Rename-onto-an-existing-name is the
  only merge route S1 offers.

## Decisions made during brainstorming

Six questions were open. They are settled here.

**Both operations cascade over the whole subtree.** Deleting `a/b` strips
`a/b` and every descendant from every note; renaming `a/b` to `x` turns
`a/b/c` into `x/c`. The alternative — acting on the exact tag only — was
rejected because it contradicts the number the user just read: a tag row's
count is already descendant-inclusive (`tagTree.ts`), so clicking a row
showing 9 and having 3 notes change is a lie the UI told.

**A rename onto an existing tag MERGES into it.** `a/b` renamed to `gemini`
when `gemini` exists joins the two subtrees, and the confirm dialog says so —
with the MOVING side's note count only, not both (corrected to match what
shipped; see the `pending` union below). Refusing was rejected: a merge is a legitimate thing to
want, and refusing forces a pointless two-step (rename to a temporary name,
then merge anyway) while offering no way to merge at all. Note this is also
the case-collision path — tags key lowercase, so renaming to `Gemini` when
`gemini` exists collides with itself.

**Confirm dialog with exact counts, and no undo.** The note TEXT is never
lost — only the `#tag` token is removed — so the blast radius of a mistake is
a tag, not a note. An undo snapshot would need a new persistence concept
(where it lives, when it expires, whether it syncs) and roughly doubles the
sub-project for a cheaper risk than it looks. A rename with no collision needs
no dialog at all; a merging rename and every delete do.

**Whitespace is collapsed, and a line left holding only whitespace is
removed.** `see #a/b today` becomes `see today`; a leading or trailing space
around the removed token is trimmed; a tag-only line goes away entirely,
newline included. The known cost is recorded rather than hidden: if that line
sat mid-paragraph with no blank line around it, removing it joins its
neighbours into one soft-wrapped paragraph. The alternative (leave an empty
line) is NOT safer — an empty line mid-paragraph SPLITS it into two
paragraphs — so neither rule is universally structure-preserving, and the one
that leaves no litter was chosen.

**`updatedAt` is preserved on every rewritten note.** Renaming a tag on 200
notes must not reshuffle the note list to the top. This is sync-safe and not a
special case: `markAllDirty` already marks notes dirty at their own
`updatedAt` for exactly this reason, and the server resolves by rev, not by
timestamp. A tag rename is bookkeeping, not authorship.

**The rename field is an anchored popover**, like Bear's 태그 편집. It reuses
`useAnchoredMenu` for positioning, keeps the tree visible for context, and
has room for the inline merge warning before the user commits. Inline row
editing was rejected as fiddly (the row is a button in an indented tree with a
trailing count, and there is nowhere to put the warning); a full modal was
rejected as too heavy for renaming one tag, and it hides the tree being
renamed within. The popover is also where S3's icon picker will live, so the
surface is built once.

### Approaches rejected

**Round-tripping each note through the editor's Markdown pipeline** and
transforming tag nodes. Rejected twice over: `src/data/` may not import
`src/features/` (enforced by `scripts/sourceLint.test.ts`), and a
parse-then-serialize round trip is not byte-preserving — renaming one tag
would silently reformat unrelated Markdown in every note it touched.

**A string replace** (`text.replaceAll('#a/b', '#x')`). Rejected, and recorded
because it is the obvious-looking answer: it matches `#a/bc`, rewrites tags
inside code fences that the masker deliberately excludes, hits
`https://x/#a/b`, and cannot see the multi-word closing `#`. It is exactly the
second-copy-of-the-grammar defect `tag-grammar.md` forbids.

## Two findings that shape the design

**Trashed notes are a resurrection hole.** `notes.listByTag` is
active-notes-only, and `trash` deletes a note's `noteTags` rows — but the
note's TEXT still contains `#a/b`, and `restore` reindexes from text. A delete
that touched only active notes would appear to work and then bring the tag
back the moment anything was restored from the trash. This is why selection is
a full scan rather than an index query (below).

**Renaming the tag you are currently viewing would throw you to All Notes.**
`AppShell` already carries a vanished-tag effect that resets the scope when
the scoped tag leaves the tree. Delete gets correct behaviour from it for
free. Rename must re-scope to the new name explicitly, or the effect fires and
bounces the user out of the tag they just renamed.

## Architecture

### `rewriteTag` — the pure core

New module `src/data/tags/rewriteTag.ts`:

```ts
rewriteTag(markdown: string, from: string, to: string | null): string
```

`to === null` deletes. Both `from` and `to` are already-normalized tag keys.

One `findTagRanges(markdown)` pass, then rewrite matching ranges
**right-to-left** so earlier offsets stay valid. A range matches when
`range.tag === from || range.tag.startsWith(from + '/')` — matched on the
NORMALIZED NAME, never on raw text, which is what makes `#a/bc` a non-match
without a special case.

For a match, `newTag = to + range.tag.slice(from.length)`, so `a/b/c` under
`a/b -> x` becomes `x/c`. The token is then written in whichever form
re-parses to `newTag`: `#newTag`, or `#newTag#` when the name contains a space
or anything else that would terminate the simple form.

**Corrected after the final review: a rename TARGET containing whitespace is
refused.** `canWriteTag` round-trips a token in ISOLATION, and that is not the
context a rename inserts it into. `parseTags` accepts the multi-word form's
closing `#` only when the character after it is a boundary, and `range.end`
for the simple form deliberately excludes trailing punctuation — so renaming
`work` to `my plan` in `done #work. next` writes `done #my plan#. next`, which
re-parses as the tag `my` and strands a literal `plan#.` in the user's prose,
unfixable by another rename. `canRenameTo` (`rewriteTag.ts`) is `canWriteTag`
minus the names that need a closer, and BOTH the popover and `tags.rename`
refuse through it — the repository does not delegate this to the UI. Emitting
a separating space instead was rejected: it only helps the
punctuation-adjacent case and leaves a floating `#my plan# . next`, which is
its own corruption. Multi-word tags remain fully supported when a user types
one into a note; `tagToken`'s multi-word branch is unchanged.

Three properties fall out of reusing `findTagRanges`, and are the whole reason
this function exists rather than a replace:

- Tags inside fenced and inline code are invisible to it, because
  `findTagRanges` reads a masked copy (`src/data/markdown/mask.ts`), so they
  are never rewritten.
- `https://x/#a/b` and `[x](#a/b)` are never touched — the `canStart`
  precondition excludes them on the preceding character alone.
- The multi-word form's closing `#` lies inside `range.end`, so `#my project#`
  is replaced whole rather than leaving a stray hash behind.

Whitespace handling, per the decision above: collapse a mid-line hole to one
space, trim a leading or trailing one, and drop a line that ends up
whitespace-only along with its newline.

The rename TARGET is validated through `normalizeTag` before any of this and
refused when it returns `null` — that is what rejects a leading `.,;:!?`, a
leading `/`, and empty segments, and it means the app writes the lowercased
form, so a note's text and the sidebar can never disagree about casing.

### The data-layer orchestration

`src/data/repositories/tags.ts` gains three methods:

```ts
affected(tag: string): Promise<{ noteCount: number; tagCount: number }>
rename(from: string, to: string): Promise<{ noteCount: number }>
remove(tag: string): Promise<{ noteCount: number }>
```

- **Selection is a full scan of `db.notes`**, filtered with `parseTags(text)`
  rather than the `noteTags` index, so trashed and archived notes are included
  and the resurrection hole closes. `notes.rebuildTagIndex` already
  establishes a full scan as acceptable for an explicit, infrequent operation,
  and one code path beats reconciling an indexed source against an unindexed
  one.
- **One Dexie transaction** over `notes`, `noteTags`, `noteLinks`, `syncState`
  and `tags`. A half-renamed vault is worse than a failed rename, so it is
  all-or-nothing.
- Each rewritten note is written with `reindexNote` — the shared authority, not
  a private copy — and marked dirty inside the same transaction with
  `markedAt` equal to the note's own unchanged `updatedAt`, which is what
  keeps the sync engine's accept guard working.
- **`TagMeta` migrates with the subtree**: `allMeta()` filtered by `from` and
  `from/`, each row's `collapsed` / `iconKey` / `sortOrder` moved to its new
  key, old keys removed through `removeMeta` so a tombstone reaches the
  account. On a merge the DESTINATION's existing metadata wins — it is the tag
  that was already there. Delete removes the whole subtree's metadata.
- `affected` and the write share one selection helper, so the number in the
  dialog is the number that gets touched.

### The UI

- **`src/ui/SidebarRow.tsx` gains one optional prop**,
  `onContextMenu?: (rect: DOMRect) => void`, and wires `src/lib/useLongPress`
  internally when it is given, so touch raises the same menu — the way
  `NoteListItem` already does it. The row stays a dumb primitive: a callback
  prop like `disclosure`, with no knowledge of tags. `src/ui/` may import from
  `src/lib/`, so this respects the boundary.
- **`src/features/tags/TagRowMenu.tsx`**, shaped like `NoteRowMenu`: a request
  `{ tag, rect }` where `rect` is a zero-size rect at the pointer for a
  right-click and the row's own rect for the `Shift+F10` keyboard route;
  `onAction`, `onClose`; positioned with `useAnchoredMenu`; `role="menu"` and
  `role="menuitem"` with accessible names, per `accessibility.md`.
- **`src/features/tags/TagRenamePopover.tsx`**: a text field seeded with the
  current name, Cancel and Rename, and inline validation — an invalid name
  (refused by `normalizeTag`) blocks the commit, and a name that already
  exists shows the merge warning with both counts rather than blocking.
- **Confirms route through `AppShell`'s existing `pending` union**, which
  today holds `purge | empty | trash | signOut`, adding
  `{ kind: 'deleteTag'; tag; noteCount; tagCount }` and
  `{ kind: 'mergeTag'; from; to; noteCount }`. **`intoCount` was specified and
  deliberately not shipped**, and this text is corrected to match the code
  rather than the reverse: the merge sentence reads "Renaming moves {count}
  notes into {name}, which already exists", where `{count}` is the moving
  side. The destination's own note count adds a second number to a
  one-sentence confirm without changing the decision the user is making, and
  it would need a second `affected` call to obtain. One count is what shipped. Every destructive
  confirm in the app stays on one mechanism instead of the sidebar growing a
  second one.
- **Rename re-scopes explicitly** to the new tag when the current scope is the
  renamed tag or one of its descendants, before the vanished-tag effect can
  fire.
- **i18n**: new keys in `src/i18n/en.ts` AND `src/i18n/ko.ts`. `ko.ts` is
  annotated `Record<TranslationKey, string>`, so a missing translation is a
  compile error — which is the desired behaviour and must not be weakened.

## Error handling

- An invalid rename target is refused in the popover, before any write.
- A rename to the tag's own current name is a no-op that closes the popover.
- The transaction either lands whole or not at all; a failure surfaces through
  the same path other repository failures do and leaves the vault untouched.
- A tag that vanished between opening the menu and confirming (another tab, or
  a sync pull) yields a zero-note result rather than an error: the outcome the
  user asked for already holds.

## Testing strategy

**`rewriteTag` unit tests** carry the weight, because it is a pure string
function and that is where the real bugs are: exact plus descendant matching
with `#a/bc` untouched; `#my project#` replaced whole with no stray hash; tags
inside fenced and inline code left alone; `https://x/#a/b` and `[x](#a/b)`
left alone; `#done.` keeping its full stop, since `range.end` deliberately
excludes punctuation `normalizeTag` trimmed; a `to` containing a space forcing
the `#new name#` form; the three whitespace cases; several occurrences in one
note. Every case also asserts the invariant that `parseTags(result)` contains
`to` (or its descendants) and does NOT contain `from` — **which holds only for
the targets the rename path now accepts**: `rewriteTag` itself will still emit
`#my plan#` before a full stop, and the final review's execution proved that
string re-parses as `my`. That is why the refusal lives in `canRenameTo`
rather than in `rewriteTag`, and why one test asserts the corrupting output
explicitly, as evidence for the refusal rather than as approved behaviour.

A property test renames `from -> to -> from` and asserts `parseTags` returns
to the original set — the weaker invariant deliberately, because whitespace
collapsing is not byte-reversible.

**Repository tests** for what only the orchestration can get wrong, first
among them **the resurrection hole, tested directly**: trash a note carrying
the tag, delete the tag, restore the note, assert the tag does not come back.
Then `TagMeta` subtree migration and merge precedence; every rewritten note
marked dirty with `markedAt` equal to its unchanged `updatedAt`; a forced
mid-way failure leaving the vault untouched; and `affected` agreeing with what
the write touched.

**Component tests** for the menu's roles and accessible names, the
`Shift+F10` route, and the popover's validation and merge warning. Assertions
must turn on a VALUE or a COUNT that changes with the behaviour — a
near-vacuous shape recurred three times in sub-project H and is called out in
`testing-and-tooling.md`.

**e2e (`e2e/tags.spec.ts`)** for what only a browser sees: right-click,
rename, and assert the sidebar shows the new name, the note's text really
changed, and **the scope followed rather than bouncing to All Notes**; delete
behind its confirm; and the long-press route on touch, since jsdom has no
`setPointerCapture` and pointer paths cannot be unit tested here. Note the
viewport must stay at or above 1024 for any assertion about three panes.

**Every guard is falsified before it is trusted** — demonstrated red against a
sabotaged implementation, not merely observed green.

## Pre-commit obligations

- The six gates: `typecheck`, `lint`, `format`, `npm test`, `build`,
  `test:e2e`.
- `tag-grammar.md`'s tracked-file NUL-byte scan, because this work touches
  tag-grammar code and prose.
- The invisible-character check on every file touched, for U+00A0 and U+200B,
  per CLAUDE.md.
- `measure:check` only if anything visual moves; the menu and popover are new
  surfaces rather than changes to measured geometry, so this is expected to be
  a no-op — verified, not assumed.

## Rulings to update when this ships

- `tag-grammar.md`: extend its Trigger to name `rewriteTag.ts`, and add the
  ruling that a tag rewrite MUST go through `findTagRanges` rather than a
  string replace, with the four failure cases above as the evidence.
- `tag-index-and-startup.md`: record that `tags.rename` / `tags.remove` write
  through `reindexNote` inside one transaction and preserve `updatedAt`.
- `scopes-and-search.md`: record that rename re-scopes explicitly and why the
  vanished-tag effect is not sufficient on its own.
