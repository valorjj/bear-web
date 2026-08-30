# Notes: editing lifecycle, autosave, reconciliation

Governs how a note is opened, edited, written back and reclaimed — the editor's
mount/unmount contract, the debounced write-behind, and the reconciliation
between the selected note and the database.

**Trigger:** any change to `src/features/notes/NoteEditor.tsx`,
`src/features/notes/useAutosave.ts`, `src/features/notes/useNotes.ts`,
`src/data/derive.ts`, `src/lib/useFlushTriggers.ts`; the `key={selectedNote.id}`
/ `seed` / `setSeed` / `justCreatedId` lines in `src/app/AppShell.tsx`; the
symbols `autoFocus`, `seedText`,
`normalizedSeedText`, `hadTextAtMountRef`, `editedRef`, `pendingDiscards`,
`discard`, `deriveTitle`, `persistedRef`, `attemptedRef`, `saveSeqRef`,
`sanitize`, `foldEditor`, `lastFoldedKeysRef`, `FOLD_PERSIST_DELAY_MS`;
`src/features/tags/useTagTree.ts`'s `reveal` and `collapsed`; any new
`useLiveQuery(` call site whose dependency array is not `[]`; `folds.get` /
`folds.set` call sites; the Backspace/Delete guard in
`src/features/editor/HeadingFold.ts`'s `handleKeyDown`; `notes.purge` /
`notes.save` call sites; and `src/data/reindex.ts`'s `reindexNote` and its
call sites.

- **A SECOND derived index, `noteLinks`, now rides `reindexNote` alongside
  `noteTags` (L2)** — `reindexNote(db, noteId, text, parseTags, parseLinks,
  noteTitle?)` replaces both tables' rows for one note from its current text
  in a single call, and it has **four call sites**: `notes.create`,
  `notes.save`, `notes.restore` (all in `src/data/repositories/notes.ts`) and
  `src/data/sync/engine.ts`'s apply path. The sync one matters most: a note
  arriving from another device that only got `noteTags` rows (not
  `noteLinks`) would make backlinks silently incomplete on exactly that
  device — the hardest kind of gap to reproduce, because the OTHER device
  that authored the note would show its backlinks correctly. Any new call
  site that reindexes a note's tags without also reindexing its links repeats
  this bug in a new place.
- **Restore must rebuild `noteLinks`, not just `noteTags`.** `src/data/backup.ts`'s
  import transaction clears and rebuilds every derived index — it now calls
  both `rebuildTagIndex` and `rebuildLinkIndex` for the same reason the tag
  index has always been rebuilt after a restore rather than trusted: derived
  data from a database whose exported rows may be stale must be recomputed,
  not copied. Task 3 found `rebuildLinkIndex` missing from this path after
  `rebuildTagIndex` had already been wired — same shape of gap as the
  sync-engine one above, one table over, and worth checking again the next
  time a THIRD derived index is added here.

- **`NoteEditor`'s `seedText` is scoped to the just-created note, and `AppShell`
  must clear it when the selection leaves that note.** A note created inside a
  tag scope is seeded with that tag, so it is not empty and the blank-note
  purge would never reclaim it by the ordinary path — but without clearing
  `seed` on selection change, reopening that note re-arms `seedText`, and a
  note the user has edited down to just its tag is silently purged: exactly the
  tag-only deletion the spec rejected. Widening `isEmpty` to "contains only
  tags" was also rejected — it would delete a note the user deliberately filled
  with nothing but tags.

- **`deriveTitle` is deliberately not idempotent.** `'# # nested'` yields
  `'# nested'`, which is that heading's true Markdown content. Stripping twice would
  delete a character the user typed.

- **`NoteEditor` must be rendered with `key={note.id}`.** The remount is what
  makes an editor instance know exactly one note for its lifetime, so its
  unmount cleanup is a correct flush-on-switch. Removing the key reintroduces
  the entire class of "wrote note A's text over note B" bugs. **The mechanism
  is pinned, the app's use of it is not.** `NoteEditor.test.tsx`'s
  `the keyed remount` suite drives the component directly, with no `useNotes`
  in between, and includes the falsification (same key across a `note` prop
  change keeps showing the previous note) — so the key genuinely is the only
  thing producing isolation there. But removing `key={selectedNote.id}` from
  `AppShell`'s render still leaves the whole suite green, because `useNotes`
  routes every selection change through a transient `undefined` that remounts
  `NoteEditor` anyway. See the fuller account in `deferred.md`
  ("The keyed-remount rule … is currently unfalsifiable at the app level");
  read the two together, because this bullet alone reads as if the suite has
  your back at the call site and it does not.

- **`useNotes` reconciles against the database, not the note list.** The list
  lags a creation by one tick, so reconciling against it deselects every note
  the instant it is created. The `{ note }` wrapper on the probe query exists
  to distinguish "still loading" from "loaded, and it is gone".

- **`useAutosave` claims a sequence token per flush.** Overlapping saves are
  real: type, pause past the debounce, keep typing. Only the latest claim may
  mutate `savedRef` or `failed`. Comparing text instead is NOT sound — after a
  rollback, `savedRef.current` can coincidentally equal an older save's own
  pending text, so a value guard passes for a superseded write.

- **`useLiveQuery` returns the _previous_ deps' value for one tick after the
  deps change — never `undefined`.** `dexie-react-hooks`' `useObservable` keeps
  one `monitor` ref across dependency-array changes and only takes a
  synchronous seed value when `!monitor.current.hasResult`; once any query on
  that hook instance has ever resolved, `hasResult` stays `true` forever, so a
  deps change does not reset it to "loading." The hook keeps exposing the old
  deps' cached result until the new `Dexie.liveQuery` subscription resolves in
  a `useEffect` (a passive effect, scheduled after commit — can lag well
  behind the deps change under CPU contention). Confirmed with an isolated
  repro of `useObservable` alone: reading its result in the same tick as a
  deps change deterministically returns the prior deps' value, every time.
  **Any `useLiveQuery` whose deps can change must tag its result with the
  dependency value it was computed for, and only trust the result once that
  tag matches the current dependency** — a mismatch means "still loading,"
  not "loaded." `useNotes` does this for both of its calls: `itemsResult` is
  `{ key, list }` keyed against the live `scopeKey(scope)` (never the `scope`
  object itself, which has a fresh identity every render), and `probeResult`
  is `{ id: selectedNoteId, note }` keyed against the live `selectedNoteId`;
  either one resolving with a stale tag now falls back to `undefined`/`null`
  instead of being trusted. **Every other call site in the app is deliberately
  untagged because its deps are the constant `[]`** — `usePaneWidths` (two
  calls), `useTheme`, `useTagTree` (two calls) and `useSmartListCounts` — so
  there is no "previous deps" to leak, and adding the tag-and-verify pattern
  there would be dead complexity. `useNotes` is currently the only call site
  with changing deps. Skipping this on a call site that _does_ have changing
  deps means a scope or selection switch can briefly render the previous
  scope's (already-stale) data — surfaced intermittently as a full-suite flake
  in `AppShell.test.tsx`'s "moves a note to the trash and restores it" test,
  and, via the identical mechanism on the `probe` query, an even more frequent
  flake in its "shows each note's own text after switching, not the previous
  note's" test. A real user under load would see the same thing: a wrong,
  empty, or stale note list or editor for a frame after switching scopes or
  notes.

- **`NoteEditor` seeds autosave from the MOUNTED EDITOR's own reading, never
  from `note.text`.** Seeded from the raw text, every non-canonical note differs
  from its own serialization the instant it opens, so merely looking at a note
  rewrites it — churning `updatedAt`, reordering the note list, and re-running
  the tag reindex. Opening a note must produce no write.
  **"Opening produces no write" silently depended on two preconditions, and
  both were violated in M4.** (1) `normalizeMarkdown` must be idempotent — a
  trailing hard break broke it, because `<br>` at the end of a block serializes
  to `'a  \n'` and parses back as the plain text `'a  '`. (2) `MarkdownManager`
  and the mounted ProseMirror schema must agree — they did not, and the
  disagreement could DELETE a note (see the next bullet). Seeding from the
  editor's own reading, in an effect after mount, makes the rule hold **by
  construction**: whatever the editor produces at rest is the baseline, so the
  two components no longer have to match for the rule to hold. React runs a
  child's effects before its parent's, which is what makes reading `handleRef`
  in `NoteEditor`'s mount effect safe.

- **The manager and the mounted schema must be asserted to AGREE, through the
  real component.** Every serializer test drives `MarkdownManager` standalone,
  and `NoteEditor`'s correctness depends on exactly the agreement none of them
  checks. `manager.parse('1. ')` emitted a `listItem` with no children, which
  the schema forbids: serializing it threw, and ProseMirror silently dropped it
  on mount, so `read()` returned a shorter document, the first flush wrote the
  truncation, and a total truncation reached `notes.purge`. Typing `1. `,
  switching away, then merely reopening the note DELETED IT. Three independent
  guards now stand between that mechanism and a user's data — `sanitize` in
  `markdown.ts` (closes the invalid-node class, but a serializer asymmetry
  leaves empty headings divergent), the editor-sourced seed above, and `discard`
  refusing to purge a note that held text at mount and was never edited
  (`hadTextAtMountRef && !editedRef`). Keep all three; this is the one place in
  the app where a single point of failure is unacceptable. The
  `manager/schema agreement` suite in `NoteEditor.test.tsx` drives the real
  component and is where a new degenerate input belongs.

- **`useAutosave` rolls back to confirmed-persisted text.** `persistedRef`
  advances only when a save RESOLVES; the failure branch restores the dedupe
  baseline (`attemptedRef`) to it. Rolling back to the optimistic marker instead
  reintroduces the M3 defect where a buffer that coincidentally re-equals a
  never-written value skips a needed save. The sequence token is separate and
  still required.

- **Delete always trashes, blank or not.** The blank-note purge was emergent —
  trash, unmount, discard — so one button meant two irreversibilities
  depending on invisible state. `NoteEditor`'s `discard` now refuses to purge
  an already-trashed note (it re-reads the record and returns when
  `current.trashedAt !== null`). The reclaim path for a blank note the user
  navigates away from is unchanged.

- **`discard` is deferred by a macrotask and cancellable, keyed by note id in
  the module-scope `pendingDiscards` map.** React's effect cleanup is not a
  reliable "this component is going away" signal — StrictMode runs
  mount/cleanup/mount in development, and `useNotes` routes every selection
  change through a transient `undefined` that unmounts the editor — so purging
  straight from the cleanup destroyed a just-created note milliseconds after
  `notes.create` returned it, and no note could be created at all under
  `npm run dev`. The map must stay at module scope: a remount is a new
  component instance, so a ref would start empty and cancel nothing.

- **The fold-restore effect's baseline MUST be seeded from the keys being
  restored, before `setHeadingFolds` dispatches — never from editor state read
  at mount.** `folds.get(note.id)` is an IndexedDB round trip; it cannot have
  resolved by the time a mount-phase effect runs, so an editor-state baseline
  captured at mount is always the empty starting state. When the restore
  later dispatches `setHeadingFolds(keys)`, the SEPARATE persist effect's
  change detector sees the (empty) baseline diverge from the (restored,
  non-empty) new state and treats a plain reopen of an already-folded note as
  a fresh edit, writing the identical row straight back to `noteFolds` every
  time the note opens. `NoteEditor.tsx`'s `lastFoldedKeysRef` is written
  inside the restore effect itself — `lastFoldedKeysRef.current =
  keys.join('|')` — BEFORE calling `foldEditor.commands.setHeadingFolds(keys)`,
  precisely to close this race rather than rely on the two effects committing
  in a lucky order.

- **A Backspace at a fold boundary is guarded at `section.end + 1` — the
  first caret position in the next VISIBLE block after the folded section —
  NOT at `contentStart + 1`.** `contentStart + 1` sits one character into the
  section's own hidden body, which `hiddenRangesFor` renders `display: none`;
  no caret can ever actually land there, so guarding it would guard a
  position Backspace never reaches. The real hazard measured is a caret at
  the START of the following block: `joinBackward` from there merges that
  visible block into the section's last hidden block, silently deleting it
  (for example, merging a following heading into a hidden paragraph erases
  the heading with one keypress and no visible change). Delete's own
  hazard is symmetric but on the OTHER side of the fold, at `contentStart -
  1` — the last position still visible, right before the hidden body starts.
  Select-all-then-delete still deletes folded content regardless of these
  guards, deliberately: that is the user asking for the whole document, and
  it is undoable. The macOS letter-chord variants (`Ctrl-h` for Backspace;
  `Ctrl-d` / `Alt-d` for Delete) are covered by the same guard, but gated
  behind `isMacOS()` — `@tiptap/core` itself only binds those chords on Mac,
  so binding them unconditionally here would claim keys Windows/Linux never
  assign this meaning to.

- **A `useLiveQuery` value is a CACHE, and must never gate a write.**
  `useTagTree.reveal` opened a collapsed ancestor only `if
  (collapsed.has(ancestor))`, where `collapsed` came from a `useLiveQuery`. That
  is a read-modify-write against a cache that can lag the database, and when it
  lagged the guard was false, so `reveal` wrote **nothing**. The row did not
  appear late — it never appeared at all, which is why activating a tag
  intermittently failed to reveal it and why two earlier attempts to fix the
  symptom by raising a test timeout could not work: **no timeout can wait out a
  write that was never issued.**
  It now writes unconditionally through an idempotent `put` and no longer takes
  `collapsed` as a dependency. Reads from `useLiveQuery` are for rendering;
  a write decision must come from the database or be made unconditionally.
  The test that guarded this asserted a **write count**, which was the wrong
  invariant — it pinned the defect in place, because the buggy code's whole
  behaviour was writing less often. It now asserts the resulting state after a
  round trip. When a test breaks on a fix like this, check whether the assertion
  was encoding the bug before changing the code to satisfy it.
  Diagnosed 2026-08-26 after the third flake of
  `AppShell.test.tsx > reveals a collapsed ancestor`. What identified it was
  measuring the happy path at **61 ms against the test's 5000 ms ceiling**: an
  80x margin means the thing being waited for is not slow, it is absent.


- **Orphaned images are reclaimed at STARTUP, never on save — and the
  save-time design was tried, tested, and found to destroy data.** The K1 spec
  put the sweep inside `notes.save`, reasoning that autosave's debounce left an
  undo window. It does not: the debounce is a few hundred milliseconds and a
  person reaching for Cmd-Z takes seconds, so deleting an image and undoing
  restored the reference to a blob that had already been deleted — a
  permanently broken image with no copy anywhere. `NoteEditor.test.tsx`'s "an
  image deleted and then undone is still stored" failed against that design and
  passes against the current one, so it genuinely discriminates between them.

  `sweepOrphanFiles` runs at boot beside `sweepBlankNotes`, with the same
  `createdBefore` time-of-check gate: the sweep is unawaited and the app is
  interactive while it runs, so an image pasted in that window must be out of
  reach. The undo window becomes however long the tab stays open. The cost is
  an orphaned blob surviving until the next launch — a few hundred KB,
  invisible — and it is worth far more than the alternative.

  It is scoped to the OWNING note's files. A sweep written against `db.files`
  as a whole passes every obvious test and destroys every other note's images;
  `sweep.test.ts` fails under exactly that mistake. `notes.purge` still
  reclaims a purged note's files immediately, because there the note is gone
  and the case is unambiguous.

## The caret on a new note

- **`autoFocus` is a SEPARATE flag from `seedText`, and collapsing the two is
  wrong.** `seedText` is set only for a note created inside a tag scope; a note
  created outside one carries no seed at all — and that is the common case, and
  precisely the one where nothing on screen moved to tell the user anything had
  happened. `AppShell` tracks `justCreatedId` alongside `seed` for this reason,
  and clears it on the same rule: the moment the selection leaves that note.
  Without the clear, re-opening the note later in the session would grab focus
  again for a note the user merely looked at.

- **The caret goes to `'start'`, never `'end'`.** The first line IS the title
  (`deriveTitle` reads it), so 'start' is the title field this app does not
  otherwise have. A note created inside a tag scope is seeded `\n#tag`, so
  `'end'` would land the caret after the tag on line two and typing would
  extend the TAG instead of naming the note.

- **`autoFocus` is read once, at mount, like `initialMarkdown`.** `RichEditor`
  is keyed by note id, so a mount is a note switch. Focus that can be
  re-triggered by an arbitrary re-render is focus that fights the user.

- **A test that reads `toHaveFocus` once cannot see this, in either
  direction.** Tiptap focuses asynchronously, so the negative assertion —
  "selecting an existing row does not steal focus" — PASSED against an editor
  hardcoded to `autoFocus`; verified by injection. It has to wait for focus and
  require that it never arrives (`await expect(waitFor(...)).rejects.toThrow()`),
  which is the only reason that test is written the slow way.
