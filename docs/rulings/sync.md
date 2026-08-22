# Sync

Governs D2's sync protocol: the per-account revision counter, the push/pull
transport, the local `syncState` bookkeeping, and the engine that reconciles
them. Local-first is unchanged by this — IndexedDB stays the source of truth
and the server is a sync target, never authoritative over what a device shows.

**Trigger:** `src/data/sync/` (`config.ts`, `transport.ts`, `engine.ts`,
`markDirty.ts`), `syncState` in `src/data/db.ts` and any repository writing to
it, `server/src/repositories/sync.ts`, `server/src/routes/sync.ts`,
`server/migrations/002_sync.sql`, `LAST_PULLED_REV_KEY`, `SYNCED_ACCOUNT_KEY`,
`src/features/account/useSync.ts`, `src/features/account/SyncStatus.tsx`,
`src/features/account/AdoptNotesDialog.tsx`, `notes.purge` / `notes.save` /
`setPinned` / `trash` / `restore` in `src/data/repositories/notes.ts`,
`markAllDirty`, and `src/data/reindex.ts`'s `reindexNote`.

- **`nextRev` must be called inside a transaction, and the
  `SELECT ... FOR UPDATE` is what makes it safe.** Two concurrent pushes each
  reading the counter outside a lock can allocate the same revision to two
  different rows — the whole scheme of "the highest rev I've seen is
  everything I need" depends on revisions being handed out one at a time per
  account.

- **`markDirty` must run inside the repository's own Dexie transaction, never
  after it.** A write that lands but whose dirty flag fails to set (a tab
  closing between the two, a thrown error after the note commits) is a note
  the sync engine will never pick up — silent, permanent divergence with
  nothing in the UI to suggest it happened.

- **`markedAt` must equal the note's `updatedAt`, which is why
  `setPinned`/`trash`/`restore` now bump it.** The engine's accept loop
  compares the stored note's `updatedAt` against the snapshot it collected to
  decide whether an edit landed mid-push (see the in-flight-edit guard below).
  A metadata-only write that left `updatedAt` untouched would make that
  comparison invisible to it, so those three call sites bump `updatedAt`
  purely so this guard can see them.

- **`syncState` must never appear in `BackupBundle`.** It is local bookkeeping
  keyed to THIS device's relationship with THIS account's server copy — a
  restored backup on a different device, or into a different account, must
  reindex and re-push from scratch, not inherit a stranger's revision
  history.

- **The server stores no `title`; `deriveTitle` is its only author.** The wire
  format (`RemoteNote`) carries `text` and nothing else derived from it. A
  title synced as data would drift the moment either side re-derives it
  independently — exactly the class of bug `deriveTitle`-as-single-author
  exists to prevent, extended across the network boundary.

- **`noteTags` is never synced; the rebuild path stays the single authority.**
  Only `notes.text` crosses the wire. Every device reindexes its own tag table
  from the text it receives, the same way boot already does. Syncing the index
  itself would risk two devices disagreeing about what their own parser would
  have produced — this project's tag index has disagreed with its own rebuild
  once already, and two independent write paths into the same derived data is
  how that happens again.

- **The cursor is per account and resets when the account changes.**
  `LAST_PULLED_REV_KEY` is meaningless against an account it was not pulled
  from; `SYNCED_ACCOUNT_KEY` changing is what `useSync` uses to detect a fresh
  sign-in (a genuinely new account, or an account switch on a device that
  still carries a previous account's notes) and gate on `AdoptNotesDialog`
  before ever calling `syncOnce`.

- **The sync cursor and `SyncOutcome.rev` never move backwards.** `syncOnce`
  writes `Math.max(remote.rev, result.rev)`, not `result.rev` alone, because
  the server's push response reports the revision PUSH allocated, which is
  lower than the pull's counter whenever the push wrote nothing. Writing the
  lower number back would re-pull the same range forever, or re-apply rows
  already applied. The same reasoning extends to `SyncOutcome.rev`: it is the
  same number reported to two audiences (storage and the status line), and a
  status line reporting a revision lower than the client actually holds is the
  same defect wearing a different hat.

- **Pull applies nothing over a locally dirty row.** A row this device has
  edited but not yet pushed is not overwritten by whatever the pull brings
  back for it — the dirty flag is a claim on that row until the next
  successful push resolves it one way or another.

- **The accept loop reads the note's CURRENT `syncState` row, not the one
  collected before the push started, and this is what protects a purge
  landing mid-push.** Reading the stale, collected row would delete the
  bookkeeping row believing a tombstone was pushed, while the note is in fact
  still `deleted: 1` locally from a purge that arrived after collection —
  producing permanent divergence with no error: the note gone locally, alive
  on the server, and past the advanced cursor. The same door exists via
  `markDeleted`'s `syncedRev === 0` early-delete path and is closed the same
  way.

- **`markAllDirty` must stamp each note's own `updatedAt` as `markedAt`, never
  a single "now" for the whole batch.** The accept guard's
  `stored.updatedAt !== snapshot` comparison is true forever if every row
  shares one `markedAt` stamped at call time — dirty never clears, and the
  whole library re-pushes on every sync, forever, to every device. This
  breaks precisely the two callers of `markAllDirty`: import and guest
  adoption, i.e. the first sync a new account ever performs.

- **A conflict copy is itself dirty, so it reaches the account.** It exists
  only if it eventually shows up on every device, which means it must survive
  through the normal dirty → push → accept path like any other edit, not some
  side channel.

- **The `(conflict)` marker lives in the copy's TEXT, not its title.** `title`
  is a derived cache of `deriveTitle(text)`, re-derived on the user's next
  edit AND by the engine's own `toNote` the moment the copy is pulled onto a
  second device — a title-only marker evaporates exactly where it is most
  needed, leaving two identically-titled notes with no way to tell the loser
  from the winner. The spec requires the losing edit be a note the user can
  "see, compare, and delete"; an indistinguishable duplicate fails "compare."

- **The conflict comparison is text-only — do NOT widen it to metadata
  fields.** A widened comparison
  (`text || pinned || trashedAt || archivedAt`) was tried and reverted: it
  makes a note trashed on two devices conflict on `trashedAt` alone, and the
  copy — deliberately created visible — resurrects, on every device, a note
  the user deleted on both. The copy's job is to preserve TEXT the server is
  about to overwrite; when the text is identical there is nothing to
  preserve, and a metadata-only difference resolves correctly by last-write-
  wins already. Losing a trash-intent that way costs one repeated trash; the
  widened version destroys nothing but resurrects everything.

- **The tombstone bookkeeping row outlives its note deliberately.** A deleted
  note's `syncState` row is not removed the moment the note itself is purged
  — it must survive long enough to be collected and pushed as a tombstone, or
  every other device keeps the note forever. The server's own 90-day sweep is
  what eventually retires it.

## Known gaps, not fixed by D2

- **Import is "replace" locally but "merge" against the server.** A note the
  server holds and an imported bundle omits is not deleted server-side, and
  is pulled back on the next sync. Predates D2's sync story; a real seam, not
  in scope here.
- **An orphaned `syncState` row for an id absent from an imported bundle
  persists at `dirty: 0` rather than being cleared.** Inert — nothing scans
  dirty-0 rows — but it never resolves into a tombstone either.
- **`sweepTombstones` counts then deletes in two non-transactional
  statements**, so a tombstone written between them is undercounted in the
  returned total. Deletion correctness and tenancy are unaffected.
- **The Door-2 owed-tombstone bookkeeping row stamps `now()` rather than a
  note `updatedAt`.** Harmless today, since the row's note is already gone
  and the accept guard's comparison never runs for it, but it is the one
  place `markedAt` is not a mirror of a stored field.
- **The tag accept branch clears `dirty` unconditionally**, with no
  in-flight-edit guard of the kind notes have. `TagMeta` has no `updatedAt` to
  compare against; a tag edit landing mid-push is lost until the tag is next
  touched. Metadata only (order, icon, collapsed).
- **`AdoptNotesDialog` mounts unconditionally beside the account popover** and
  self-gates on `open`, rather than only mounting when the menu itself has
  been opened at least once.
