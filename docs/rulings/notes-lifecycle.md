# Notes: editing lifecycle, autosave, reconciliation

Governs how a note is opened, edited, written back and reclaimed — the editor's
mount/unmount contract, the debounced write-behind, and the reconciliation
between the selected note and the database.

**Trigger:** any change to `src/features/notes/NoteEditor.tsx`,
`src/features/notes/useAutosave.ts`, `src/features/notes/useNotes.ts`,
`src/data/derive.ts`, `src/lib/useFlushTriggers.ts`; the `key={selectedNote.id}`
/ `seed` / `setSeed` lines in `src/app/AppShell.tsx`; the symbols `seedText`,
`normalizedSeedText`, `hadTextAtMountRef`, `editedRef`, `pendingDiscards`,
`discard`, `deriveTitle`, `persistedRef`, `attemptedRef`, `saveSeqRef`,
`sanitize`; any new `useLiveQuery(` call site whose dependency array is not
`[]`; and `notes.purge` / `notes.save` call sites.

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
