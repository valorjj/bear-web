# M7 — Search Design

**Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Predecessors:** M5 (tags), M5.5 (design language), M6 (smart lists)

## Goal

Find a note by typing part of what is in it, without leaving the note list —
and fix the task-item input rule that M6 diagnosed and deliberately deferred.

## Scope

In: a query field in the note-list header, in-memory filtering of the active
list, match highlighting in result rows, and the bullet-to-task input rule.

Out, with rulings:

- **Command palette.** The parent spec bundles it into M7 ("Search provider,
  results UI, command palette"). It is a different subsystem — search finds
  *content*, a palette runs *actions* — and it belongs after search rather than
  beside it. Its own spec.
- **Search operators** (`#tag`, `-exclude`, `"exact phrase"`). This project has
  exactly one hand-written parser (`parseTags`) and it cost two milestones of
  grammar rulings. A second one needs a demonstrated need.
- **Highlighting matches inside the editor.** That needs ProseMirror
  decorations over a document the user is concurrently editing. Separate
  problem, separate risk.
- **Search history, saved searches, regex, fuzzy matching.**

## Rulings

### Search does not touch `NoteScope`

Search is a pure filter applied to the list a scope produced. `NoteScope` keeps
its two arms.

```
scope ──▶ useLiveQuery(listForScope) ──▶ Note[] ──▶ filterByQuery(notes, query) ──▶ render
          deps: [scopeKey]                          pure, no database access
```

Two properties follow, and both are the reason for the shape:

**`NoteScope` stays total.** A third arm would reopen the M5 defect class
verbatim: `isTrash`, `allowsTrash`, `acceptsNewNote` and `seedTagFor` are each
gated with `===`, each total over two arms, and each would silently become
partial. The one nobody re-checked would be the bug.

**No `useLiveQuery` dependency changes.** Putting `query` inside the live query
would change its deps on every keystroke, and this project has a documented,
reproduced rule that `useLiveQuery` returns the *previous* deps' value for one
tick after a deps change — never `undefined`. Search would then render the
previous query's results for a frame on every character typed, and would need
the tag-and-verify pattern to correct it. Filtering outside the live query means
the condition cannot arise. `useNotes`' existing deps and tags are untouched.

As a bonus, `filterByQuery` is a pure function testable with no database and no
DOM, in the same shape as `SMART_LIST_PREDICATES`.

### Matching

Case-insensitive substring over the note's full text — title, body and inline
hashtags, since tags live in the text.

- **Both sides are `.normalize('NFC')`-ed before comparison.** Hangul has two
  Unicode representations, and they are not `===`-equal. Text arriving through
  `importDatabase` from a macOS-authored file can be NFD while a query typed in
  the browser is NFC; without normalization a Korean note becomes unfindable by
  its own contents. This is invisible in an English-only test suite, so it needs
  a Hangul NFD/NFC test case pinned explicitly.
- **Substring, never word-prefix.** Korean does not delimit morphemes with
  spaces, so a word-prefix index would fail on most Korean queries.
- **The query is trimmed; a query that is empty after trimming applies no
  filter at all.** Not "matches everything" — the distinction is load-bearing
  for snippets, below.

### No debounce

The filter is an in-memory pass over an array already in hand. There is no IO
to coalesce, and a debounce would only introduce a window where the rendered
list disagrees with the field — the exact class of staleness the architecture
above was chosen to avoid. If a note count ever makes this measurable, the fix
is memoization, not delay.

### Creating a note clears the query

A new note is empty and matches no non-empty query, so it would be created and
immediately invisible. This is the same defect M6 already solved for scopes with
`acceptsNewNote` — a note created somewhere it cannot be seen — and it gets the
same resolution: the action that creates the note also moves the view to
somewhere the note exists.

Clearing the query is preferred over the alternative (seeding the note with the
query text) because the query is a search, not a template.

### Switching scope keeps the query

Search filters within a scope, so carrying the query across a scope change is
the consistent reading. The cost is that switching to a scope with no matches
shows an empty list, which could be misread as "this list is empty". Therefore
the no-results empty state must name the query as the cause and offer to clear
it — it is a different state from "this list has no notes", with different copy.

### The snippet follows the match

`deriveSnippet` currently returns the first non-empty line after the title. With
a query active, a match on line 12 would produce a snippet with nothing
highlighted in it. So `deriveSnippet(text, query?)` returns the first *matching*
line when a query is given, and its current behaviour otherwise. One optional
parameter; the no-query path is unchanged.

### Highlighting uses the accent colour, not a background

A background highlight would disappear on the selected row, whose background is
already `--bear-selected`. The match renders as `text-accent` with a heavier
weight, which reads on both selected and unselected rows and needs no new token.

### `NoteListItem` gets an explicit `aria-label`, closing a carried defect

The row's three sibling spans concatenate with no separator today, so it
announces as `"Groceries #work14:32milk"`. This is a defect carried since M5.5
with the ruling "belongs to whichever milestone next touches `NoteListItem`".
M7 touches it — splitting the snippet into highlighted and plain runs makes the
concatenation strictly worse — so M7 closes it: the row button carries an
explicit `aria-label` composed of title, date and snippet with separators.

Note that `aria-label` overrides the element's contents for name computation,
which is also what keeps the highlight markup from leaking into the name.

### Keyboard

`Cmd/Ctrl+F` focuses the field, preventing the browser's own find. In a notes
app the app's search is the one the user means, and the browser's find only
searches the ~30 rows currently in the DOM. `Escape` in the field clears the
query.

This is the one ruling here that overrides a browser default. It is a single
event handler and trivially reversible if it proves annoying.

### Sidebar counts ignore the query

The seven smart-list counts are properties of the lists, not of the current
view. A query filtering the note list must not renumber the sidebar.

## Components

| File | Responsibility |
| --- | --- |
| `src/features/notes/search.ts` | `filterByQuery(notes, query)`, `normalizeForSearch(text)`, `findMatchRanges(text, query)`. Pure; no React, no Dexie. |
| `src/features/notes/SearchField.tsx` | The input, its clear button, its label. Reads `useT`. |
| `src/features/notes/HighlightedText.tsx` | Renders a string with match runs marked. Pure presentation over `findMatchRanges`. |
| `src/features/notes/format.ts` | `deriveSnippet` grows one optional `query` parameter. |
| `src/features/notes/NoteListItem.tsx` | Uses `HighlightedText`; gains the explicit `aria-label`. |
| `src/features/notes/NoteList.tsx` | Renders `SearchField` in its header; no-results empty state. |
| `src/app/AppShell.tsx` | Owns `query` as `useState`, clears it in `handleCreate`. |
| `src/features/editor/taskItemPromotion.ts` | The bullet-to-task input rule. |

`search.ts` lives beside the note list rather than in a `src/features/search/`
of its own: it filters `Note[]`, it renders in the note list's header, and it
has no consumer outside that today. A future command palette that needs it can
lift it then, with a second call site to justify the move.

`query` is `useState` in `AppShell`, alongside `scope` — ephemeral, not
durable. Pane widths are in the settings table because a dragged pane is a
lasting preference; a half-typed search is not.

## The task-item input rule

Typing `- [ ] milk` produces a plain bullet containing the literal text
`[ ] milk`. StarterKit's `bulletList` input rule fires on `- ` first, and
`TaskItem`'s `wrappingInputRule` cannot wrap a paragraph that is already inside
a `listItem`. M6 verified that the Todo predicate, registry and counts are all
correct — this is purely an editor gap.

The fix is a new input rule: inside a `bulletList` item whose paragraph is
empty, typing `[ ] ` or `[x] ` promotes the item to a task item, checked state
following the character typed. It must not fire mid-paragraph, and it must not
fire outside a list (`TaskItem`'s own rule already covers that case and still
must).

**Promotion must not convert the neighbouring items.** A `taskItem` may only
live in a `taskList`, so promoting one item of a three-item bullet list has to
split the list — the other two items stay bullets. Whether Tiptap's
`toggleTaskList()` does this on a single-item selection, or whether an explicit
transform is needed, is an open implementation question; the requirement is the
observable outcome, and it needs a test either way. Getting this wrong silently
rewrites list items the user did not touch.

**Do not fix this by loosening the Todo predicate** to match literal
`[ ] text` bullets. That was ruled out in M6 and the reason still holds: it
would make Todo count notes that contain no task item at all.

### This needs a structural assertion, not only a round-trip one

A promoted task item and a hand-authored one serialize to the identical
Markdown, so a round-trip test passes whether or not the input rule fires — the
same blind spot that let a dead `==highlight==` tokenizer and a live-but-banned
underline mark both ship in M4. The rule needs an assertion on the parsed
document (a `taskItem` node exists, with the right `checked` attribute), driven
through the real component, plus an e2e test on the real keystroke path.

Round-trip coverage needs entries in **both** the fidelity and stability
suites, per the standing rule that they are not interchangeable.

## Testing

**Pure units** — `filterByQuery`, `normalizeForSearch`, `findMatchRanges`,
`deriveSnippet(text, query)`. No database, no DOM. Cases must include Hangul in
both NFC and NFD, an empty and whitespace-only query, a query matching only in
a hashtag, overlapping and adjacent match runs, and a query containing regex
metacharacters (`.`, `*`, `(`) which must be treated literally.

**Component** — the query clears on note creation; the query survives a scope
change; the no-results state renders distinctly from the empty-list state; the
row's accessible name reads with separators and does not include highlight
markup.

Every one of these must be verified by fault injection, not by reading. The
"clears the query on create" test in particular sits exactly where M6 shipped a
vacuous absence test — assert the positive (the new note is visible after
creation) rather than only the absence of a query.

**End-to-end** — typing in the field narrows the list against a real IndexedDB;
`- [ ] milk` typed as real keystrokes produces a real checkbox. One assertion
in `e2e/appearance.spec.ts` that the field reads as a control at rest, since it
is new chrome and that suite is the only thing in this project that can see it.

## Risks

**Highlighting and the accessible name interact.** Splitting text into runs is
precisely the change that broke `SidebarRow`'s name in M5.5, where the first
fix attempt edited the failing tests to match the new output. A role-based test
that fails during this work is reporting a behaviour change, not a stale
expectation.

**The input rule races other input rules.** That is the entire defect being
fixed; a fix that merely wins the race in the tested case may lose it in
another. Cases needed: `[ ] ` at the start of an empty bullet item, mid-text
(must not fire), in the middle item of a three-item bullet list (the other two
must survive as bullets), inside an ordered list, inside a nested list, and
inside a blockquote.
