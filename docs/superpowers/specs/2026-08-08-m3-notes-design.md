# M3 — Notes CRUD — Design Spec

**Date:** 2026-08-08
**Status:** Approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`

## Summary

M3 makes the application usable. A user can create a note, type into it, see it
in the note list, reload the page and find the content intact, delete a note to
the trash, and restore it.

The editor is a plain `textarea`. That is deliberate: it proves the full
persistence loop before Tiptap's complexity can hide a data-layer bug. M4
replaces the widget and nothing else.

### Non-goals

Pinning, tag pills, the smart-list registry, search, keyboard shortcuts, a toast
primitive, and Tiptap. The sidebar rows M3 adds are two hardcoded entries, not a
registry, and must not be built as one.

## Decisions made during brainstorming

Three questions were open before this spec. They are settled here.

**Selection state lives in `useState` in `AppShell`.** The parent spec reserves
Zustand for ephemeral UI state, but M3 has exactly one such value and both
consumers — the note list and the editor — are siblings under `AppShell`.
Introducing a store now would decide the project's state architecture on the
thinnest possible evidence. Migrating one `useState` into a store later, when a
third distant consumer appears, is a small and obvious change.

The alternative of copying the codebase's only existing pattern — durable, via
`settings` plus `useLiveQuery` — was rejected: it would round-trip every click
through IndexedDB and persist a note id that may be purged out from under it.

**Trash is reachable in M3.** M6 owns trash management, but shipping `delete`
with no path back is not acceptable even temporarily. M3 adds two hardcoded
sidebar rows, Notes and Trash, in a single file that M6 deletes outright.

**A note whose text is empty is discarded when selection moves off it.** This is
Bear's behavior and it keeps mis-clicks from filling the list with identical
blank rows.

## Architecture

`NoteEditor` is keyed by note id:

```tsx
<NoteEditor key={selectedNoteId} noteId={selectedNoteId} />
```

React remounts the component on every switch, so an instance only ever knows one
note for its entire lifetime. This is the central structural decision of M3, and
it removes a class of bug rather than guarding against it:

- "Seed the buffer once, on switch" is not an effect with a dependency array to
  get wrong. It is mount.
- "Flush with the id you were editing, not the currently selected one" is not a
  discipline. The instance has no access to any other id.
- Flush-on-switch is the unmount cleanup, which React guarantees runs before the
  next instance mounts.

```
AppShell                      layout + selection + scope
├── usePaneWidths()           extracted from AppShell
├── ScopeSidebar              two hardcoded rows: Notes / Trash   ← M6 deletes
├── NoteList                  useLiveQuery over the active scope
│   └── NoteListItem          title, snippet, date
└── NoteEditor  key={id}      textarea + buffer + autosave
    └── useAutosave()         debounce and flush machinery
```

### Files

New, under `src/features/notes/`:

| File               | Responsibility                                          |
| ------------------ | ------------------------------------------------------- |
| `NoteList.tsx`     | Live query over a scope; renders rows; reports selection |
| `NoteListItem.tsx` | One row: title, snippet, relative date                   |
| `NoteEditor.tsx`   | Textarea, buffer, empty state                            |
| `ScopeSidebar.tsx` | Two hardcoded rows. Disposable by construction           |
| `useAutosave.ts`   | Debounce, flush triggers, retry. No JSX                  |
| `snippet.ts`       | Pure: note text to a one-line preview                    |
| `scope.ts`         | `NoteScope` type and the query for each scope            |
| `index.ts`         | The feature's narrow public surface                      |

Also new: `src/ui/Button.tsx` and `src/app/usePaneWidths.ts`, the latter
extracted from `AppShell` so it stops doing two jobs before it is asked to do a
third.

`src/ui` continues to import nothing from `src/app`, `src/data`, or `src/i18n`.
Components reach persistence only through `@/data`. Every user-facing string goes
through `useT`, with new keys added to both `en.ts` and `ko.ts`.

## Data flow

`AppShell` holds two pieces of state, both plain `useState`:

```ts
const [scope, setScope] = useState<NoteScope>('active');
const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
```

`NoteList` subscribes to whichever scope is active:

```ts
useLiveQuery(() => (scope === 'active' ? notes.listActive() : notes.listTrashed()), [scope]);
```

Ordering comes from the repository and the list does not re-sort: `listActive`
returns `updatedAt` descending, `listTrashed` returns `trashedAt` descending —
most recently deleted first, which is what a user looking for something they
just deleted wants. There is no pinned-first grouping; pinning is M6's.

### Selection reconciliation

When the live query returns a list that no longer contains `selectedNoteId` —
the note was trashed, purged, or the scope changed — `AppShell` clears the
selection and the editor pane shows its empty state.

This rule is not optional. Without it the editor holds a note that no longer
exists and every subsequent write throws.

## The editing loop

The editor is the sole writer of its note's text while it is open. Live-query
updates for the currently open note are ignored, so the caret is never moved by
a write the user did not make. Cross-tab reconciliation is not in Phase 1.

```
mount(noteId)             buffer = note.text
keystroke                 setBuffer; schedule a flush 300ms out
300ms quiet               notes.save(noteId, buffer)
blur                      flush now
visibilitychange, hidden  flush now
beforeunload              flush now (best effort)
unmount                   flush now; then if buffer === '' → notes.purge(noteId)
```

The latest buffer is held in a ref, so the unmount cleanup reads the current
value rather than a closure captured at mount.

A flush whose buffer equals the last-saved text is skipped. Idle blur and
visibility events must not churn `updatedAt`, which would reorder the note list
for no reason, nor re-run the tag reindex.

### The blank-note rule

The discard condition is exactly `buffer === ''`. No trim, no dirty flag, no
session tracking. One comparison, trivially testable.

The accepted consequence: typing a single space and navigating away leaves an
`Untitled` note behind. That is the price of the rule being this simple.

Blank notes are purged, not trashed. Filling the trash with empty notes defeats
the purpose of discarding them.

The discard is the unmount cleanup, not a standing invariant: a blank note that
is still open when the page reloads is never purged, because `beforeunload`
only flushes and does not unmount. This is spec-compliant — the rule is
"discarded when selection moves off it," and a reload is not a selection
change — but it is a second, known way a blank row can become permanent. A
startup sweep of empty notes would close it and is deferred to a future
milestone, not folded into M3.

### Durability limit

`beforeunload` can only *start* an asynchronous IndexedDB write; it cannot wait
for one. On a hard kill, up to 300 milliseconds of typing is lost. The trigger
that actually protects the user is `visibilitychange`, which fires on tab switch
and on mobile backgrounding with time to complete.

This is stated so that nobody later mistakes the `beforeunload` handler for a
guarantee.

## Error handling

**A save throws.** Quota exceeded is the realistic case. The buffer is not
cleared and the flush is not marked satisfied, so the next trigger retries the
same text. The editor renders an inline message beneath the textarea. Not a
toast: no toast primitive exists yet, and introducing one here pulls M4 and M9
scope backwards. Under no circumstance does a failed save overwrite the last
known-good text in IndexedDB.

**A save throws because the note was purged.** This is benign rather than a
failure. The editor does not attempt to distinguish it from a real error by
matching on the thrown message, which would be fragile. Every save failure is
treated identically — retryable, with an inline message — and selection
reconciliation unmounts the editor before any retry can matter. This fails in
the safe direction.

**IndexedDB unavailable.** Already handled by M2's degraded mode: the in-memory
fallback plus a persistent banner. M3 adds nothing. The note flows work; they
simply do not survive a reload, which the banner already states.

## Testing

| Layer      | Coverage                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit       | `snippet.ts`. `useAutosave` under fake timers: a burst of edits coalesces to one write; flush-on-unmount fires; an unchanged buffer writes nothing; a throwing save retries |
| Components | `NoteList` renders from the live query and marks selection; `NoteEditor` seeds its buffer, debounces into `notes.save`, and purges on unmount when empty; selection reconciliation clears a vanished note |
| End-to-end | Create, type, reload, content intact. Delete, find it under Trash, restore, find it under Notes. A blank note is discarded on switching away                  |

### The persistence test must be falsifiable

M2 shipped a persistence test that could not fail, and the task reviewer
approved it. The failure mode is reading the expected value out of the same page
that was just typed into: with persistence completely broken, the assertion
compares a stale default against itself and passes.

The M3 test therefore asserts against a literal constant defined in the test
file, never a value read back from the page after the write. Verification is by
injection: neutering `notes.save` must turn the test red.

## Carried-forward debt

`parseTags` remains the `noTags` stub until M5, so **every note created during M3
accumulates an empty tag index**. M5 must rebuild the index on upgrade. This is
the largest outstanding debt in the project and M3 is what makes it grow.

Nothing in M3 may paper over this with a temporary regex. A wrong tag parser
corrupts user data silently, which is why the parent spec makes TDD mandatory
for it.

## Definition of done

- Create a note, type, reload, find the content intact.
- The note list shows title, a one-line snippet, and a date, ordered by most
  recently updated.
- Delete moves a note to the trash; the Trash row lists it; restore returns it.
- A note left empty is discarded when selection moves off it.
- New user-facing strings exist in both `en.ts` and `ko.ts`.
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`,
  `npm run format`, and `npm run build` all pass.
