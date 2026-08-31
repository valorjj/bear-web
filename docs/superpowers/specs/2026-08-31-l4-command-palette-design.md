# L4 — The command palette

Written 2026-08-31, the same day L3 shipped. The fourth of the L-series.

L4 was not on the user's original list of nine candidate features. It was added
during the roadmap triage because it is the strongest "built for developers"
signal in the app and because **it makes everything else discoverable** — the
graph, sixteen themes, three export formats and seven smart lists are all
reachable today only by knowing where to look.

## Purpose

Every capability this app has is behind a pane, a menu, a drawer or a
memorised chord. A user who has not read the source does not know the graph
exists, that PDF export exists, or that `⇧⌘3` selects a smart list.

L4 adds **one input that reaches every capability by name**, plus jump-to-note
by title. It adds no new capability of its own — and that is the point. It is
a discovery and speed layer over what M0–L3 already built.

## Why this is cheap HERE, specifically

The roadmap called this "assembly, not invention", and three of the four parts
already exist:

- **`Dialog.tsx`** already traps focus, handles Escape and a backdrop click, and
  supports `label`/`labelledBy`/`describedBy`.
- **`AppShell` already owns every handler** the commands need — scope, view,
  selection, the `useSetting` hooks — so nothing has to be lifted.
- **`AppShell` already has a destructive-confirm mechanism**: a `pending` union
  (`{kind:'purge'; id} | {kind:'empty'}`) driving `ConfirmDialog`. Destructive
  commands extend that union rather than growing a second confirm path.
- **`notes.allNoteIndex()`** — added by L3 — is already exactly the projection
  note results need: `{id, title, updatedAt}`, with note text skipped.
- **`useExportRunner()`** is documented as "shared by the two places that can
  start an export" and is already called from `NoteEditor` and `NoteList`. The
  palette is simply the third caller; no new plumbing.

**One thing the roadmap got wrong.** It claimed `filterByQuery` would do the
matching. It will not: `filterByQuery` is substring search over note **text**
(`normalizeForSearch(note.text).includes(target)`), not a label matcher. L4
needs its own matching. `normalizeForSearch` is still reused for folding.

## Constraints measured before deciding

- **`Mod-k` is UNBOUND in `node_modules/@tiptap`**, verified with the grep
  `useScopeShortcuts`'s docblock prescribes. `⌘K` is therefore free for the app.
- **Bundle headroom is 1,650 B gzipped.** `main` measured 338,350 B against
  `scripts/bundleSize.test.ts`'s ceiling of 340,000 after L3. A command
  registry, a matcher and a dialog do not fit in 1,650 bytes.

## Decisions already taken

### The palette is lazy-loaded, and the ceiling is not raised for L4

`CommandPalette` is reached through `React.lazy(() => import(...))`, the same
structural pattern L3 established and for the same reason: it does not fit
otherwise. Only the `⌘K` listener is eager, in `useScopeShortcuts`.

If the bundle guard fails on this branch, something leaked across the boundary.
Find the leak. **Raising `CEILING_BYTES` is a separate decision requiring its
own measurement, and is not part of L4.**

That said, the ceiling is now shaping every feature, and this is the second
sub-project in a row bent around it. A deliberate, measured raise is likely the
right move before L5 — but as its own decision, not as a side effect.

### It searches commands and notes. Not tags, and not note content

- **Commands** — actions by name.
- **Notes** — jump by TITLE.
- **Not tags.** Tags are one click away in the sidebar and behind the drawer on
  a phone; adding a third result type buys mostly phone reachability at the cost
  of three-way ranking.
- **Not note content.** `⌘F` search (M7) already does full-text, and two ways
  to do the same thing is a design smell. The palette complements it.

### Four command groups ship in v1

Navigation (open graph, the seven smart lists, focus search, open the theme
picker), note actions (new, duplicate, pin/unpin, trash, restore, and the three
exports), appearance (cycle theme, preview size, sort order, hide sub-tag
notes), and account (sign in, sign out, sync now).

### `buildCommands` only emits commands that are valid RIGHT NOW

`buildCommands(deps) => Command[]` is pure — no React, no DOM, no database.
A `Command` is `{ id, group, label, hint?, destructive?, run }`.

"Restore note" is absent unless the open note is trashed; "Export as PDF" is
absent when signed out. **Absent, not disabled**: an entry you can still arrow
onto and press Enter on is worse than one that is not there, and it makes the
tests assertions about *which commands exist for a given state*, which is where
the bugs are.

Rejected: a runtime `registerCommand()` registry. There are no plugins and no
dynamic contributors, so it buys nothing and adds lifecycle ordering bugs —
commands appearing and vanishing with whatever happens to be mounted. Also
rejected: building the array inline in `AppShell`, which is already ~560 lines
and would gain ~150 untestable ones.

### Destructive commands always confirm

Trash a note, empty trash, sign out: the palette closes and `ConfirmDialog`
opens through `AppShell`'s existing `pending` union. They are never executed
inline. Sign-out and empty-trash have no undo, and a fuzzy match that logs you
out is a bad trade for one saved keystroke.

### Empty query lists commands only

A vault of 2,000 notes dumped into an empty box is noise. The empty state is
where the palette answers "what can this app do?", which is the discoverability
job it exists for. Notes appear only once something is typed.

### Two sections in a FIXED order: Commands, then Notes

Fixed rather than reordered by score. A list whose *sections* move as you type
makes muscle memory impossible — the thing you were about to press Enter on
jumps. Within a section, results sort by score. Notes cap at eight.

### Matching is subsequence with a word-boundary bonus, and no dependency

`"epdf"` finds "Export as PDF". Matching runs over the TRANSLATED label so it
works in Korean, folding through the existing `normalizeForSearch`. A
fuzzy-match library is disqualified by the headroom above.

The rule is explicit rather than left to taste, so the tests can assert an
order rather than a vibe. A candidate matches if the query's characters appear
in the label in order (subsequence). Rank by, in this priority:

1. the label STARTS WITH the query (highest);
2. the number of matched characters that landed on a word boundary — a label's
   first character, or one following a space, `/`, `-` or `:` — descending;
3. the span from first to last matched character, ascending — a tighter match
   beats a scattered one;
4. label length, ascending — the shorter of two equally good matches;
5. `id`, ascending, so ties are stable and screenshots reproducible.

Rule 5 exists for the same reason `buildGraph` sorts: an unstable order is an
unstable UI and an untestable one.

**Corrected from six rules to five during Task 1.** This section originally
specified a sixth rule, `allBoundary` (every query character landed on a
boundary), ranked between `startsWith` and the boundary count. It was deleted
as provably redundant: `allBoundary` is true exactly when
`boundaryCount === query.length`, a condition `boundaryCount` alone already
expresses, so it could never be the deciding factor between two candidates —
whichever comparison rule 2 already settled would have settled it first.
`src/features/palette/matchCommands.ts` implements the five that remain.

### No matches offers creation

"Create note titled *<query>*" becomes the sole result. It turns the palette's
failure case into the app's most common action.

### The keyboard model, and the ARIA pattern that goes with it

`↑`/`↓` move and wrap at both ends, `Enter` runs, `Esc` closes. **Focus never
leaves the input** — that is what lets you keep typing to refine.

This is the combobox pattern and is implemented as such: the input is
`role="combobox"` with `aria-expanded` and `aria-controls`, the list is a
`listbox`, results are `option`s, and the highlighted result is tracked with
`aria-activedescendant`. Moving real focus into the list is the usual mistake
and breaks typing outright.

### Keyboard-only invocation, deliberately

There is no button. **L3's finding that a keyboard-only surface is unreachable
by touch does NOT transfer**, and the distinction matters: the graph had no
other access path, so keyboard-only made a whole feature unreachable.
Everything the palette does is reachable another way by construction — that is
what a palette is. On a phone the drawer and note list already provide those
paths, and the note-list header just gained a graph button.

Revisit if phone use shows demand. Recorded as a choice, not an omission.

## Architecture

```
src/features/palette/
  commands.ts          buildCommands(deps) -> Command[]         pure
  matchCommands.ts     subsequence match + score, sorted        pure
  CommandPalette.tsx   the Dialog surface; DEFAULT export for React.lazy
src/app/useScopeShortcuts.ts   + onPalette on KeyK
src/app/AppShell.tsx           + paletteOpen, lazy import, CommandDeps,
                               + pending union gains {kind:'signOut'} and
                                 {kind:'trash'; id}
```

`src/features/palette/` imports `@/data`, `@/ui` and `@/i18n`, and **nothing
from `src/app/`** — every handler arrives through `CommandDeps`, which
`AppShell` builds.

Note results come from `notes.allNoteIndex()`, read once when the palette
opens. A snapshot, for the same reason L3's graph is one: the palette is open
for seconds, and a list reordering under the cursor mid-keystroke is worse than
being one save stale.

## Testing

- **`buildCommands`** — which commands exist with no note open, a note open, a
  TRASHED note open, signed out, signed in. Plus one invariant: **every command
  that mutates irreversibly carries `destructive: true`**, a rule that rots
  silently as commands are added.
- **`matchCommands`** — ranking against REAL labels (`"epdf"` → Export as PDF),
  not synthetic strings.
- **Component** — an empty query shows commands and **zero** notes (a count,
  not a presence check); `aria-activedescendant`'s VALUE changes with the arrow
  keys and matches the highlighted option's id; focus stays in the input;
  arrowing wraps at both ends.
- **`AppShell` integration** — picking a destructive command opens
  `ConfirmDialog` **and mutates nothing until confirmed**, asserted by checking
  the data is unchanged after the pick, not merely that a dialog appeared.
- **Playwright** — `⌘K` in a real browser, and one navigation command end to
  end.

## Risks, in the order they are worth worrying about

1. **The lazy boundary.** 1,650 B of headroom means one accidental eager import
   breaks the build. Verify with the same fault injection L3 used: convert the
   import to eager and confirm the bundle guard FAILS.
2. **`⌘K` is Firefox's search-bar shortcut.** `preventDefault` handles it, but
   verify in a real browser rather than assuming. Chrome and Safari are free.
3. **`aria-activedescendant` is the easiest thing here to ship subtly broken**,
   and a test asserting merely that options have ids would not catch it.
4. **~25 new translation keys — and the Korean wording is explicitly NOT a
   gate for L4.** The user decided on 2026-08-31 to swap the Korean labels by
   hand afterwards. So implementation supplies a correct, compiling Korean
   string for every key (the `Record<TranslationKey, string>` annotation makes
   a missing one a compile error, and that annotation must never be weakened
   to work around it) and no reviewer should block on the phrasing. English
   labels ARE in scope and must read well, because they are what the matcher
   ranks against and what the tests assert.

## Out of scope

- Tag results, and note-content search (both covered above).
- A runtime command registry for plugins.
- Recent/frequently-used ranking, and any persisted usage history.
- Multi-step commands (a command that prompts for further input).
- A touch entry point.
- Raising the bundle ceiling.
