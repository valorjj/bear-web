# S4 — Tag autocomplete, and plain-click filtering — Design Spec

**Date:** 2026-09-08
**Status:** Draft — awaiting review
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Absorbs:** sub-project S2 (the autosave hold), specced in passing at
`docs/superpowers/specs/2026-09-07-tag-rename-delete-design.md:37-40` and
folded in here as Task 1 — see "S2 is load-bearing, not adjacent" below.
**Rulings that govern this work:** `docs/rulings/tag-pills.md`,
`docs/rulings/tag-grammar.md`, `docs/rulings/notes-lifecycle.md`,
`docs/rulings/markdown-and-schema.md`, `docs/rulings/accessibility.md`,
`docs/rulings/scopes-and-search.md`

## Summary

Typing `#a` in the editor opens a suggestion list of every tag that matches,
and a plain click on a tag pill filters the note list by that tag.

The two halves are one sub-project because the second depends on the first.
`docs/rulings/tag-pills.md:204` records the current divergence from Bear and
names its own expiry condition:

> **Plain click on a tag pill edits; Mod-click activates.** Bear filters on a
> plain click, and this is a deliberate divergence: Bear can afford it because
> its tag autocomplete makes mistyped tags rare, while this app has none, so
> editing a tag in place is the normal repair path and a pill that defended
> itself against being edited would be worse than an inert one. **If
> autocomplete ever ships, revisit this ruling** — it is the premise the
> divergence rests on.

This spec ships the autocomplete and then collects on that promise. Doing the
second without the first would leave a user with a mistyped tag and no cheap
way to fix it.

### Non-goals

- **Autocomplete outside the editor.** Not in search, not in the command
  palette, not in S1's rename dialog. One surface, one grammar.
- **The multi-word tag form (`#a b#`).** Excluded by construction rather than
  by a guard: the match rule below requires a boundary immediately after the
  caret, and whitespace is a boundary, so the popover closes the moment a
  space is typed. Documented, not defended against.
- **Fuzzy ranking.** Prefix then substring, as `LinkAutocomplete`'s
  `matchingTitles` already does. L2 ruled a fuzzy ranker out as a tuning
  problem with no end and that ruling stands.
- **Changing `[[link]]` pills to plain-click.** See "Tags and links diverge
  deliberately" below.
- **A shared autocomplete core.** Rejected for now with a reason; see
  "Approach" below.
- **Pinning and the icon picker** (S3), and **"use as workspace"**, both
  already carried as non-goals by S1.

## Decisions made during brainstorming

Six questions were open. They are settled here.

**1. The edit path is Bear's: no modifier gesture at all.** A plain click
filters. The caret is placed with the arrow keys, or by clicking just past the
pill. Repair happens through this sub-project's autocomplete and through S1's
right-click rename. The two rejected alternatives were inverting the modifier
(plain click filters, Mod-click places the caret) and double-click-to-edit;
the latter is not merely worse but incoherent, because the double-click's
first `mousedown` filters before the second arrives, so the scope visibly
changes and then the user edits anyway.

**2. The typed text is always row 0, and it is pre-selected.** Bear matches
`#a` against `bear`, `bear/환영` and `자산화/SAP` — substring
anywhere, so the highest-ranked existing tag is routinely unrelated to what
the user is typing. With existing tags ranked first, `Enter` on `#a` would
silently rewrite it to `#bear`. Row 0 is therefore always the query itself,
labelled as itself, and accepting it is a no-op that closes the popover.

A consequence worth naming: **the list can never be empty**, which removes an
empty-state string and its branch that `LinkAutocomplete` needs.

**3. `Tab` or a click accepts; `Enter` and `space` are never intercepted.**
Clicking a row does exactly what `Tab` on that row does, including the
per-row difference in decision 4. This
diverges from `LinkAutocomplete`, where `Enter` accepts, and the divergence
follows from decision 2. With the literal pre-selected, `Enter` on row 0 has
nothing to insert, so it could only swallow a keystroke that means "new
paragraph" in every other context. The rejected middle option — `Enter`
accepts an existing tag but passes through on the literal row — makes one key
do two things decided by an invisible highlight position.

`Esc` dismisses and remembers the tag's `from`, so the list stays shut while
that same tag is being edited and reopens on the next document change. This
is `LinkAutocomplete`'s `dismissedFrom` mechanism, unchanged.

**`Tab` already means something in this editor**, and the collision is
resolved by the popover's open state alone: `@tiptap/extension-list-keymap`
binds `Tab` to indent a list item. While the popover is open the handler
consumes `Tab` and the list keymap never sees it; while it is closed the
handler returns `false` on the very first guard and indentation behaves
exactly as it does today. A tag typed inside a list item is therefore the case
to test, not the case to forbid.

**4. Accepting an existing tag descends and stays open.** The tag text is
replaced with `#<key>`, the caret lands at the end, and **no trailing space is
inserted** — so the match rule immediately re-evaluates and the popover
reopens showing what lives under the tag just accepted. `Tab` again descends
another level. A space commits and closes at any depth.

Accepting row 0 instead commits and closes, because there is nothing to
insert; it sets `dismissedFrom` so the list does not immediately reopen on the
tag the user just settled on.

**5. On a phone, the caret is placed by tapping past the pill and using the
platform's own caret handle.** This is what Bear does on iOS. The rejected
alternatives were a long-press menu (a new surface to build, test and
translate, for a repair the autocomplete makes rare) and making phone taps
edit while desktop clicks filter, which is the per-pointer divergence J2's
touch parity set out to remove.

**6. A tap on a pill navigates to the filtered list.** On a phone the note
list and the editor are separate screens, so changing the scope silently
behind the editor would make the tap look like it did nothing. The tap sets
`phoneScreen` to `'list'`, and the result of the gesture is visible.

## Findings that shape the design

These were established by reading the code during brainstorming, not assumed.

**`parseTags` does not index ancestors.** Saving `#a/b` writes one `noteTags`
row, for `a/b`. The ancestor `a` exists only as a node synthesized by
`buildTagTree` (`src/features/tags/tagTree.ts:30`). Bear's own list shows both
`bear` and `bear/hwan-yeong` as rows, so the suggestion source must be the
**tree's** keys, not the raw index rows. `listByTag` already defaults to
`includeDescendants: true` (`src/data/repositories/notes.ts:307`), so
filtering by a parent-only `#a` correctly returns every note under `a/*`.

**S2 is load-bearing, not adjacent.** S2 exists to stop `#a` and `#a/b`
materialising on the way to `#a/b/c/d`. Decision 4 deliberately parks the
caret at the end of `#a/b` while the user reads the next level, and
`AUTOSAVE_DELAY_MS` is 300 — so any pause to read the list writes the
intermediate tag to the index, where it then appears in the sidebar and in
every future suggestion list, removable only through S1's delete. The
autocomplete makes this worse rather than better, because pausing to read is
the normal way to use it. S2 is therefore Task 1 of this branch rather than a
separate sub-project.

The dependency runs the other way too, and resolves cleanly: the plugin unions
the tree's keys with tags found in the **open document**, so S2's held
autosave does not blind the suggestion list. Without that union, holding the
write would mean a tag typed moments ago is unsuggestable — which is exactly
when the user is most likely to type it again.

**Two gestures genuinely regress, and both are accepted.** A `mousedown` that
calls `preventDefault()` is the only point that can stop the caret moving;
`docs/rulings/tag-pills.md` records why `handleClick` (on `mouseup`) is too
late — by then the caret has moved, suppression has lifted the pill, and the
thing the user clicked has vanished from under the cursor. Consequences:

- Dragging a selection that **starts inside** a pill filters instead of
  selecting. Starting from the space before the tag still works.
- **Double-clicking a tag** to select the word filters on the first
  `mousedown`, so no selection happens.

Both are rare and the alternative reintroduces the failure the existing ruling
was written about.

**`phoneScreen` is derived, not state**, so "navigate to the list" is one
existing call. `AppShell.tsx:575` reads `const phoneScreen = selectedNoteId
=== null ? 'list' : 'editor'` and `:581` defines `backToList` as
`() => select(null)`. Landing on the list therefore means DESELECTING the
note — there is no screen variable to set.

Two consequences, both accepted. The note is no longer selected when the list
appears, though it is guaranteed to be IN that list, because it carries the
tag that was just tapped; it is one visible tap away. And the phone Back
gesture will not return to it: `useOverlayHistory(mode === 'phone' &&
phoneScreen === 'editor', backToList, 'editor')` treats the editor as the
overlay, and its effect cleanup consumes its own history entry with
`history.back()` when `isOpen` flips false — so a programmatic `select(null)`
leaves the history stack correct, not desynced, but also leaves nothing for
Back to return to. Pushing a second entry to make Back work is more machinery
than the gap deserves.

**Bundle headroom is 1,884 B gzipped.** CLAUDE.md records this after L3, with
the guard's ceiling at 340,000 B and `scripts/bundleSize.test.ts` summing the
entry chunk's transitive static import closure. A new editor extension is
eager code and cannot be hidden behind a `React.lazy` boundary the way
`GraphView` and `CommandPalette` are. If the extension does not fit, the
ceiling is raised deliberately with the reason recorded in the same commit —
the guard exists to force that decision, not to forbid growth. Predicting the
number is not acceptable; Task 3 measures it.

## Approach

`TagAutocomplete.ts` is built as a **sibling** of `LinkAutocomplete.ts`,
mirroring its shape, and `LinkAutocomplete.ts` is not touched.

The alternative considered was extracting a shared popover core first —
renderer, keyboard state machine, aria plumbing — and refactoring
`LinkAutocomplete` onto it. Rejected for two reasons. First, the two popovers
now differ in three of their four behaviours (the literal row, `Tab` rather
than `Enter`, descend-and-stay-open), so a shared core would be mostly
injected difference. Second, L2's hard-won rulings are attached to that file's
exact lines — `skipTrailingNodeMeta` on `move` and `dismiss`, the deliberately
volatile widget key, the deliberately stable aria ids — and a refactor puts all
of them back in play. This repo's own record is that a "pure move" of tag and
mask code silently mutated a regex escape and three em dashes while the suite
stayed 170/170 green (`docs/superpowers/NEXT.md`, L2 Task 1).

`@tiptap/suggestion` was rejected on a measured number rather than on taste:
it is not currently installed, the headroom is 1,884 B, and its render
contract is React-portal-shaped, foreign to this repo's widget-decoration
popovers.

A shared core becomes the right call when the third autocomplete arrives —
fence-language suggestions, carried at `docs/superpowers/NEXT.md:1145` — with
two real examples to generalise from instead of a guessed seam.

## Architecture

### Task 1 — the autosave hold (absorbed S2)

`useAutosave` gains one option:

```ts
/**
 * Consulted when the DEBOUNCED timer fires. Returning `true` re-arms the
 * timer instead of writing, up to `maxDeferMs` from the first deferral.
 * Never consulted by `flush()`.
 */
defer?: () => boolean;
maxDeferMs?: number; // default 4000
```

**Only the debounced write defers. Every explicit `flush()` ignores the hold
entirely** — blur, `visibilitychange`, `beforeunload`, and the unmount
flush-on-switch. Deferring those would risk real data loss for a cosmetic
index benefit, and blur-commits-the-tag is also the correct behaviour: the user
has left.

`NoteEditor` supplies the predicate. `RichEditorHandle` already exposes
`editor`, so no handle change is needed:

```ts
defer: () => {
  const editor = handleRef.current?.editor ?? null;
  if (editor === null) return false;
  const { state } = editor;
  return tagRangeAt(state, state.selection.from) !== null;
},
```

`tagRangeAt` is already exported from `TagPill.ts` and already hit-tests the
grammar rather than the decoration set, which is what makes it correct here: a
tag the caret sits inside has no pill, and that is exactly the case being
detected.

The 4-second cap is what stops a caret parked in a tag from holding a write
indefinitely. It is measured from the FIRST deferral, not reset per
re-arm — otherwise a user typing slowly inside a long tag could defer forever.

### Task 2 — the match, and the ranking (pure)

Two exported functions in `TagAutocomplete.ts`, both pure and both unit-tested
without a mounted editor.

`tagAutocompleteMatchAt(state): TagAutocompleteMatch | null` returns the
`{ from, to, query }` of the live tag before the caret. It mirrors
`linkAutocompleteMatchAt`'s guards:

- Refuses a non-empty selection, a non-textblock parent, and a `code` block.
- Reads `maskedBlockText($from.parent)`, so a `#` inside inline code cannot
  open the list, and the one-character-per-position invariant keeps
  `parentOffset` a valid index with no separate offset arithmetic.
- Requires the caret to be **at the end of the tag text, with a boundary
  immediately after it** — whitespace, `MASK`, or end of block. This single
  rule does three jobs: `#wo|rk` cannot open the list (accepting there would
  strand `rk`), the multi-word form is excluded by construction, and the
  repair path still works because deleting-to-the-end is how a typo is fixed.
- Requires a query of **at least one character**, which keeps the popover out
  of the way of the `# ` heading input rule and stops an eight-row list
  flashing whenever someone starts a heading.

`matchingTags(keys, query): string[]`:

- Row 0 is always `query` itself.
- Then keys whose `normalizeTag` form starts with the normalized query, then
  those that contain it, alphabetical within each group.
- Deduped against row 0, so an exact existing key never appears twice.
- Capped at 8 rows total, `MAX_RESULTS` as in `LinkAutocomplete`.
- Both sides normalized, so `#Work` finds `work`.
- **A query ending in `/` narrows to that tag's subtree.** `normalizeTag`
  strips trailing slashes, so `#a/` normalizes to `a` and would otherwise
  behave identically to `#a` — offering `assets/sap` and `bear` again rather
  than `a/b` and `a/c`. Matching therefore runs against the slash-terminated
  path when the query ends in one. This is what makes decision 4's
  descend-and-stay-open actually show descendants.

### Task 3 — the plugin, and the popover

The suggestion source is a new `tagKeys: string[] | undefined` prop drilled
`AppShell` -> `NoteEditor` -> `RichEditor`, fed from the `useTagTree()` that
`AppShell` already builds and flattened from `TagNode[]` to a key list by
walking children depth-first. `undefined` while the live query is unresolved,
never coerced to `[]`. This is the path `onActivateTag` already takes.

Deliberately NOT a second `useLiveQuery(() => notes.allTagRows())` inside
`RichEditor` the way `noteTitles` is: `allTagRows` is a full table scan, so a
local query would double the sidebar's cost on every tag write, and
`RichEditor` would then have to re-derive ancestors with its own
`buildTagTree`.

The keys ride a command (`setTagAutocompleteKeys`) rather than an option, for
the reason `setLinkAutocompleteTitles` does, and every meta-only dispatch —
that command, `move`, and `dismiss` — carries `skipTrailingNodeMeta`.

The plugin unions the drilled keys with tags in the open document. `tagHitsIn`
is currently private to `TagPill.ts` and is exported for this; it is already
shared by `tagRangeAt` and `tagDecorations`, so a third consumer is consistent
with the existing ruling rather than a new pattern. Ancestors of live-document
tags are synthesized the same way `buildTagTree` does.

Rendering follows `LinkAutocomplete` exactly:

- A widget decoration at the tag's end, `contentEditable = 'false'`.
- `role="listbox"` with `aria-activedescendant`, using the same split between a
  **volatile widget key** (query and active index baked in, so
  `WidgetType.eq` cannot leave a stale list on screen) and **stable element
  ids** keyed on `from` alone (so `aria-activedescendant` does not change out
  from under a screen reader mid-selection).
- Rows draw the hash glyph through `renderIconMarkup`, because a ProseMirror
  widget cannot render React. A new glyph, if one is needed, is a verbatim
  entry in `ICON_NODES` plus a row in `Icon.test.tsx`'s `it.each`.
- New `.bear-tag-autocomplete-*` classes, shared with the link popover's rules
  by adding them to those rules' SELECTOR LISTS rather than by introducing a
  common base class. Both express the same intent, but a selector list needs
  no change to `LinkAutocomplete.ts`'s emitted markup, which keeps this
  sub-project's promise that the file is not touched.
- One i18n key, `editor.tagAutocomplete.listLabel`, in `en.ts` and `ko.ts`.
  No `empty` key: decision 2 makes an empty list unreachable.

Every option and command name here is prefixed with the extension's own name
— `tagAutocompleteLabels`, `setTagAutocompleteKeys` — because
`buildEditorExtensions` spreads every extension's options into ONE flat
object, so a colliding bare name is overwritten with no error and no type
failure. `TableHandles`' `onOpenMenu` already collided with `HeadingFold`'s
that way.

`tagAutocompleteLabels: { listLabel: string } | null` follows the established
null-means-no-plugin discipline — the schema-only `editorExtensions` constant
registers no plugin at all, as with `codeLabels` and `TableHandles`' `labels`.

**Measure the bundle at the end of this task** and either report the fit or
raise the ceiling with the reason in the commit message.

### Task 4 — plain click, and the phone

`TagPill.ts` loses the modifier gate and the `isMacOS` import. Everything else
in the `mousedown` handler stays, including left-button-only (so right-click
still reaches the context menu) and the ask-first-consume-second contract,
which now matters more: when `handleActivateTag` declines — a tag typed within
the last few hundred milliseconds, or one of M7.6's two documented unindexed
pill classes — falling through without `preventDefault()` gives the user the
caret a plain click would have given anyway, so the decline is invisible
rather than surprising.

`AppShell.handleActivateTag` gains one line after `setScope`: on `mode ===
'phone'`, set `phoneScreen` to `'list'`.

`editor.css:922`'s `[data-mod-held='true'] .ProseMirror .bear-tag` becomes a
plain `:hover` rule with the same `--bear-tag-fill-strong` treatment. Its
comment currently justifies itself with "it is the only affordance there is,
since plain click deliberately still edits" and is rewritten, not caveated.
`data-mod-held` and its key listener stay alive for the link rules at `:976`
and `:981`.

`editor.tagPill.hint.mac` and `.other` collapse into one
`editor.tagPill.hint` — "Filter by this tag" — and the `isMacOS()` branch at
`RichEditor.tsx:282` disappears.

**Tags and links diverge deliberately.** A tag click re-scopes the list beside
you and is one click to undo; a link click navigates away and loses your
place. Bear draws the line in the same spot. `[[links]]` keep Mod-click and L2
is not touched.

### Task 5 — documentation, rulings, gates

See "Rulings to update when this ships" below, plus the pre-commit
obligations.

## Error handling and refusals

Every refusal in this design is silent-and-honest rather than an error
message, and each one has a defined fallback:

| Condition | Behaviour |
| --- | --- |
| `tagKeys` not yet resolved (`undefined`) | No plugin state change; the live-document union still produces suggestions. Never treated as "no tags". |
| `handleActivateTag` declines | No `preventDefault()`; ProseMirror places the caret, exactly as a plain click would. |
| Caret inside a tag mid-word (`#wo|rk`) | No popover. |
| Query is empty (bare `#`) | No popover. |
| A space is typed at any depth | Popover closes, the tag commits. |
| `defer()` held for 4s | The write proceeds regardless. Data loss is never the trade. |

## Testing strategy

**Pure functions, unit.** `tagAutocompleteMatchAt`: refuses `#wo|rk`, refuses
inside inline code via `MASK`, refuses an empty query, refuses after
whitespace, accepts at end-of-block and accepts before whitespace.
`matchingTags`: row 0 is always the query, deduped against an exact existing
key, prefix before substring, alphabetical within group, capped at 8,
normalized on both sides, synthesized ancestors present.

**The state machine, against the real mounted view.**
`linkAutocomplete.test.ts:47` drives real `KeyboardEvent`s through
`editor.view.someProp('handleKeyDown', ...)`, so this needs no e2e:
`Tab` accepts; `ArrowUp`/`ArrowDown` move and clamp; `Esc` dismisses and stays
dismissed while the same tag is edited, then reopens on the next document
change; accepting a descendant leaves the popover open on the next level;
accepting row 0 closes it. And the assertion most likely to rot: **`Enter` and
`space` are not consumed** — the handler returns `false`.

**Click, unit.** `tagPill.test.ts:394`'s technique — a view faked to
`{ state, posAtCoords: () => ({ pos, inside: pos }) }` — drives `mousedown`
with no layout engine. A plain left mousedown filters; a declined activation
returns `false` without `preventDefault`; `button !== 0` is untouched. The two
platform-branch tests are DELETED, not adjusted.

**Three traps this repo has already paid for, carried in explicitly:**

1. **Vacuous-by-default assertions.** CLAUDE.md records three near-vacuous
   shapes from H. Two tests here must be demonstrated FAILING against a
   sabotaged implementation before being trusted: "Enter passes through"
   against a handler that consumes `Enter`, and the widget-key test against a
   constant key (which leaves a stale list on screen —
   `linkAutocomplete.test.ts` already pins that shape for links).
2. **`skipTrailingNodeMeta`.** `TrailingNode`'s `appendTransaction` runs on
   every dispatched transaction, so a meta-only dispatch inserts a spurious
   trailing paragraph into any note ending in a list or table, which autosave
   then persists. Its regression test must reach the dispatch under test using
   **only tagged transactions from the very first one** — the vulnerability
   flag is burned by the first untagged transaction, which is how L2's first
   version of this test passed with the fix removed. Use `quietlySelect`.
3. **`someProp` short-circuits across plugins.** `tagPill.test.ts:593`
   documents it: a test must not stop at the first `handleDOMEvents.mousedown`
   handler, or it silently exercises whichever plugin happens to run first.

**Autosave hold, unit.** Fake timers: a deferred write re-arms rather than
writing; `flush()` writes through the hold; the 4-second cap is measured from
the first deferral and not reset per re-arm. The cap test must fail against an
implementation that resets it.

**e2e** (`e2e/tags.spec.ts`, modelled on `e2e/backlinks.spec.ts:161`): type
`#` plus characters, press a real `Tab`, assert the inserted text AND that the
popover is still open on descendants, then that a space commits. A plain click
on a pill re-scopes the note list. In `e2e/phoneEditor.spec.ts`: tap a pill,
land on the list screen, scoped.

Before trusting any e2e result that follows a source change, and always before
a fault injection: `lsof -ti:4173 | xargs -r kill -9`.

## Pre-commit obligations

- All six gates: `npm test`, `npm run test:e2e`, `npm run lint`,
  `npm run typecheck`, `npm run format`, `npm run build`.
- **`npm run measure:check`** — the pill's hover state changed, which is
  visual. Run `measure` on `main` too before blaming this branch.
- **`npm run shots`** on demand, counting the 272 files rather than trusting
  the exit code.
- **The bundle number**, from `scripts/bundleSize.test.ts` or by gzipping the
  built file. Never from Vite's build-log estimate, which reads ~3 kB worse
  than reality.
- **Invisible-character check** on every file touched:
  `python3 -c "d=open(PATH).read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"`
  must print `0 0`.

## Rulings to update when this ships

- **`docs/rulings/tag-pills.md:204`** — the plain-click ruling is REPLACED
  outright, not caveated. Its own text asks for exactly this once autocomplete
  ships. The replacement records that plain click filters, that the two
  regressing gestures (selection-drag from inside a pill, double-click to
  select) were accepted with reasons, and that `mousedown` is still the only
  workable point.
- **`docs/rulings/tag-pills.md:213`** — the Mod-is-Cmd ruling narrows to
  `LinkPill`, and the note that `tagPill.test.ts` asserts both platform
  branches is struck.
- **`docs/rulings/markdown-and-schema.md`** — a new keyboard binding
  (`Tab` in the editor) and a new extension, both of which that file's trigger
  covers. Record that `Enter` and `space` are deliberately NOT intercepted and
  why.
- **`docs/rulings/notes-lifecycle.md`** — the autosave hold: only the
  debounced write defers, every explicit flush writes through, the cap runs
  from the first deferral.
- **`docs/rulings/tag-grammar.md`** — the boundary rule that excludes the
  multi-word form from autocomplete by construction.
- **`docs/rulings/accessibility.md`** — the listbox's stable-id and
  volatile-widget-key split, mirroring L2's entry.
- **`CLAUDE.md`** — a status-table row for S4; the S2 row is folded into it.
- **`docs/superpowers/NEXT.md`** — the S4 narrative, and S2 marked as absorbed
  rather than pending.
