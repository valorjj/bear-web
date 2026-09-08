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
`notes.save` call sites; `src/data/reindex.ts`'s `reindexNote` and its call
sites; `src/features/graph/useGraphSnapshot.ts`; and
`src/features/landing/WelcomeSeeder.tsx` / `seedWelcomeNote.ts`. Also
`useAutosave.ts`'s `defer`, `maxDeferMs`, `AUTOSAVE_MAX_DEFER_MS` and
`deferSinceRef` (S4/S2), and the `defer` predicate `NoteEditor.tsx` builds
from `TagPill.ts`'s `tagRangeAt`.

- **A SECOND derived index, `noteLinks`, now rides `reindexNote` alongside
  `noteTags` (L2)** — `reindexNote(db, noteId, text, parseTags, parseLinks,
  noteTitle?)` replaces both tables' rows for one note from its current text
  in a single call, and it has **five call sites**: `notes.create`,
  `notes.save`, `notes.restore` (all in `src/data/repositories/notes.ts`),
  `src/data/sync/engine.ts`'s apply path, and — since S1 —
  `src/data/repositories/tags.ts`'s `apply`, the shared body of `tags.rename`
  and `tags.remove`. The sync one matters most: a note
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

- **KNOWN GAP (S1): an open `NoteEditor` can write a tag rewrite back out.**
  `NoteEditor` freezes `initialMarkdown` at mount and is deliberately "the
  sole writer of this note's text while it is open"
  (`NoteEditor.tsx:111-113,167`). Rename or delete a tag while a carrying note
  is on screen, type one character, and autosave writes the PRE-rewrite text
  back — resurrecting the tag on that one note, with the tag index dutifully
  rebuilt from it. The hazard class predates S1 (sync's apply path has exactly
  the same shape: it can write a note the editor is holding), but S1 is what
  makes it reachable by two deliberate clicks with the note visible. **Not
  fixed, deliberately, and not to be discovered again as if it were news.**
  The cheap mitigation is the one this file already documents for a different
  reason: remount or re-seed the editor for any note the rewrite touched —
  `AppShell` already keys `NoteEditor` by `note.id`, so a rewrite-generation
  suffix on that key would do it, at the cost of dropping the caret. Whoever
  takes it should also decide whether the sync path deserves the same
  treatment, because half a fix here would be worse than none: it would make
  the failure rarer without making it impossible, which is the state this
  repo treats as the worst of the three.

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

## The graph is a snapshot, not a subscription

- **L3's relationship graph reads the vault once, in `useGraphSnapshot.ts`,
  and deliberately does NOT use `useLiveQuery`.** Relayout is not incremental
  — every node's position is recomputed from scratch — so a live graph would
  rearrange itself under the reader's cursor, for up to `LAYOUT_TICKS`' worth
  of settle time (measured up to ~2s at 2,000 nodes), because of an autosave
  firing on a note the reader cannot even see while the graph is open. No note
  is editable while the graph surface is open, so the only thing that can
  change the vault underneath a snapshot is a sync pull; reopening the graph
  re-snapshots and picks up whatever changed. Positions are cached in module
  scope by a topology hash so reopening after editing nothing is instant.
  Without this ruling, the next session "fixes" the graph by wiring it back
  to `useLiveQuery` and reintroduces the rearrange-under-the-cursor bug.

- **`useLocalePreference`'s mirror-absent check is an OPTIMISATION, not a
  correctness guard, and the distinction matters because `useTypography`'s
  identical-looking check IS one.** There, recovery WROTE the settings row, and
  doing so when nothing needed recovering clobbered a fresh choice. Here
  recovery only reads, and a present mirror always matches the row (they are
  written together), so removing the check costs one wasted IndexedDB read and
  breaks no behaviour. It is therefore pinned by a read-count assertion rather
  than by a behavioural one — an unfalsifiable guard is worse than no guard,
  because it looks like coverage.

- **What DOES protect a fresh choice there is the `touched` flag, and it only
  works because the current locale is read through a ref.** Written first with
  the effect's captured `locale`, the comparison used a stale value; with only
  two locales that staleness happened to make the guard unreachable, so it
  tested clean while an accident did its job. Reading through a ref makes the
  comparison mean what it says and makes the guard falsifiable — removing it
  now fails `LanguageToggle.test.tsx`.

## The welcome note is seeded through the ordinary write path, not a special one

- **`WelcomeSeeder.tsx` calls `seedWelcomeNote.ts`, which writes through
  `notes.create()` exactly like any note a person types themselves.** It
  carries no special kind, no sync exemption, and no separate reconciliation
  path — it is a normal note that happens to be created by the app instead of
  a keystroke. Anything true of `notes.create()` elsewhere in this file is
  true of it.

- **The gate is `seen && !seeded && count === 0 && settled`, and `settled`
  names the session statuses EXPLICITLY:**

  ```ts
  const settled =
    state.status === 'signedOut' ||
    (state.status === 'signedIn' && sync.status === 'idle' && sync.lastSyncedAt !== null);
  ```

  **It must never be written as a negation of `signedIn`.** It was
  `!signedIn || (sync.status === 'idle' && sync.lastSyncedAt !== null)` until
  2026-09-07, and this file described that `!signedIn` half as "the GUEST
  short-circuit". It is not, and that mis-description is what let the bug
  live: `!signedIn` also covers `loading` and `unavailable`. `useSession`
  starts EVERY boot at `loading`, so the negation was true on the very first
  commit, the effect fired, `ran.current` latched, and the note was seeded
  before `/me` had answered — the signed-in half of the condition was
  unreachable in production. On a second device that meant a welcome note
  created into an empty local database, then `AdoptNotesDialog` offering to
  push the duplicate up.

  There are three statuses, not two, and each branch is a separate ruling:

  - **`signedOut` seeds immediately.** A guest has no session hint, so
    `useSession` resolves `signedOut` in a microtask with no fetch at all;
    the seed lands one tick after mount rather than during it. This is the
    path the landing's e2e spec exercises.
  - **`loading` must NOT seed.** Nothing is yet known about whether an
    account's notes are on their way, and an empty local database in that
    window is not evidence of an empty account.
  - **`unavailable` must NOT seed.** It is reachable only when a session hint
    was present, i.e. this browser HAS signed in before. Unreachable is not
    the same answer as signed out, and treating it as one seeds a duplicate
    into an account whose notes simply could not be fetched.

- **`settled` is a VALUE, not an idle-after-syncing TRANSITION.** For a
  signed-in account, a transition rule — waiting for `syncing` to flip to
  `idle` — would miss the seed forever on an account whose first sync
  completes before `WelcomeSeeder` mounts: that component never observes a
  `syncing` status at all, so there is no edge to detect. Reading the settled
  VALUE instead of a transition is what makes the seed reachable on the
  fastest-syncing accounts, not just the slow ones.

- **A mocked session cannot test this gate, and `WelcomeSeeder.test.tsx`
  alone did not.** Those tests inject `session = { status: 'signedIn' }` from
  render 0 — a state the real app never starts in — so every one of them
  passed against the buggy expression. `WelcomeSeeder.boot.test.tsx` renders
  the component inside the REAL `SessionProvider` with `SESSION_HINT_KEY` set
  and `/me` held open, and asserts nothing seeds while the fetch is in
  flight. Keep both: the mocked file covers the decision table, the boot file
  covers the sequence.

- **`seedWelcomeNote` marks the device seeded when it declines because notes
  already exist, and that is safe only because of the gate above.** Returning
  `false` without the mark left every existing install and every second
  device re-reading `notes.listActive()` on every boot forever, and — worse —
  meant a device later emptied to zero notes would seed a welcome note and
  sync it up, the "delete it and it comes back" the flag exists to prevent.
  The mark is only correct because the settled gate guarantees the count was
  read after the account's notes had arrived.

- **No `useLiveQuery` gates this write.** The count check reads the database
  once at the moment the gate's conditions are otherwise satisfied; making it
  reactive would re-run the whole seed decision on every note count change,
  including the seed's own write, for no behavioural gain — the same shape
  the graph snapshot section above rejects for a different reason.

## The autosave hold (S4, absorbing S2)

`useAutosave` gains an optional `defer: () => boolean` and `maxDeferMs`
(default `AUTOSAVE_MAX_DEFER_MS = 4000`). It exists so a tag mid-typing
(`#economy/us-mar|`) never materialises the intermediate tag `#economy` or
`#economy/us` into the tag index just because the user paused inside it —
S4's descend-and-stay-open autocomplete makes pausing to read the popover the
NORMAL way to use it, which is what turns this from a nice-to-have into
load-bearing: without the hold, `AUTOSAVE_DELAY_MS` (300 ms) writes the
half-typed tag on nearly every keystroke pause, and the sidebar and every
future suggestion list then carry a tag the user never meant to create,
removable only through S1's rename/delete.

- **Only the DEBOUNCED write defers. Every explicit `flush()` writes through
  the hold, unconditionally** — blur, `visibilitychange`, `beforeunload`, and
  the unmount flush-on-switch never consult `defer` at all. Deferring those
  would trade a real risk of data loss for a cosmetic index benefit, and
  "blur commits the tag" is also simply correct: the user has left the note.
- **The cap is measured from the FIRST deferral of the current hold, and is
  NEVER reset by a re-arm.** `deferSinceRef` is set once when a hold begins
  and cleared only when the hold ends (by `flush()` or by the predicate
  finally returning `false`); each re-arm inside `schedule`'s `arm()` checks
  `Date.now() - since < maxDeferMs` against that original timestamp, not
  against the moment of the re-arm. A cap reset per re-arm would let a user
  who keeps typing slowly inside one long tag defer indefinitely — the whole
  point of the cap is to bound that, not merely to slow it down. The
  regression test for this must fail against an implementation that resets
  the cap on re-arm, not merely assert the cap exists.
- **`NoteEditor` supplies the predicate through `tagRangeAt`, not through the
  decoration set.** `defer: () => tagRangeAt(state, state.selection.from) !==
  null` reuses `TagPill.ts`'s existing grammar hit-test rather than checking
  whether a pill is currently painted — a tag the caret sits inside has NO
  pill (`docs/rulings/tag-pills.md`'s suppression rule), which is exactly the
  case this predicate must detect. Checking decorations instead would defer
  nothing, ever, for the one case that matters.
