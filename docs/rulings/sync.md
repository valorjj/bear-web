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

- **A conflicted TAG resolves by taking the server's copy and clearing
  `dirty`; there is no `(conflict)` copy for tags.** A tag row is metadata —
  order, icon, collapsed — not content, so per-row last-write-wins loses
  nothing the user typed. Without this the row never converges at all: a
  conflicted tag is absent from `accepted` so the accept loop never touches
  it, `applyTags` skipped the server's copy because the row was dirty, and
  the cursor has already moved past the server's revision for it — leaving
  `dirty: 1` at its old `syncedRev` forever, re-pushed and re-conflicted
  every sync. Tags are keyed by NAME, so this is the ORDINARY case, not a
  race: on guest adoption `markAllDirty` marks every tag dirty at
  `syncedRev: 0`, and on a second device every tag the account already holds
  (`#work`, `#todo`) conflicts on the very first sync. **This path
  deliberately does NOT carry the in-flight-edit guard the tag accept branch
  has, and the asymmetry must not be "fixed" by making the two match.** The
  accept branch keeps a row dirty when a local edit landed mid-push, because
  the server took that row's push and a cleared flag would strand the later
  edit. A CONFLICT means the server REJECTED this device's push and its own
  copy is newer; parking the row dirty there re-pushes the same losing
  `baseRev` on the next sync and conflicts again, which is the
  never-converging loop this ruling exists to close. Overwriting a mid-push
  tag edit costs at most the order, icon or collapsed state of one tag,
  recoverable by touching it again — the loop costs convergence permanently.

- **`syncState` must never appear in `BackupBundle`, and neither must any
  `sync:`-prefixed `settings` key.** `sync:lastPulledRev` and
  `sync:accountId` live in `settings` only because that is the app's
  key-value table; they are the same device-and-account-local bookkeeping.
  `exportDatabase` strips them by prefix and `importDatabase` drops them
  again before `markAllDirty` runs, because bundles predating the filter are
  already in the wild. Carried across, they transplant a stranger's cursor
  (export at 500, import onto a device at 12, revisions 13-500 never pulled)
  and silently suppress the adoption dialog, which gates on the same key. All
  of it is local bookkeeping keyed to THIS device's relationship with THIS
  account's server copy — a restored backup on a different device, or into a
  different account, must reindex and re-push from scratch, not inherit a
  stranger's revision history.

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

- **The sync cursor is the PULL's rev and nothing else — never the push's,
  never `Math.max` of the two.** The two numbers mean different things.
  `pull` returns `users.rev_counter` as of the pull: a DELIVERY WATERMARK,
  "everything allocated up to here has been handed to this device". `push`
  returns the revision THAT PUSH allocated, which says nothing about
  revisions another device allocated in between. Because the push allocates
  after the pull has already returned, its rev is always >= the pull's, so
  storing it — or `Math.max`, which selects it for exactly that reason —
  silently skips every revision written by another device between the two
  legs: device A pulls at 10, device B pushes note X at 11, A allocates 12
  and stores 12, and X is NEVER delivered again unless B edits it a second
  time. A note written on one device silently never reaches the other.
  `SyncOutcome.rev` reports the same pull rev, for the same reason. This
  ruling previously said the opposite — it mandated the `Math.max` on the
  theory that a push writing nothing returns a lower counter and would rewind
  the cursor. That rewind cannot happen (the push allocates last), so the
  guard was a no-op that entrenched the defect it was meant to prevent. The
  correct rule's only cost is that this run's own pushed rows come back on
  the next pull and are re-applied identically, which is harmless.

- **The tag accept branch has an in-flight-edit guard too, and `markedAt` is
  the only thing it can use.** `TagMeta` carries no `updatedAt`, so the guard
  compares the row's CURRENT `markedAt` against the one `collect` snapshotted
  — clearing `dirty` unconditionally strands a tag edit that landed mid-push
  on this device forever, looking perfectly saved. The snapshot map is keyed
  by kind AND key for this: tags are keyed by name, so a bare key would let a
  note id collide with a tag name.

- **The push body is capped BEFORE it is parsed (`MAX_BODY_BYTES`, three
  times the 10 MiB quota), and `Content-Length` is not the only check.** The
  quota lives inside `push()`, long after `c.req.json()` would have built the
  whole object graph in memory on a Mac Mini in someone's house. The stream
  is counted as it arrives and abandoned at the cap, because a chunked
  request has no declared length and a declared one can simply lie.

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
- **`AdoptNotesDialog` mounts unconditionally beside the account popover** and
  self-gates on `open`, rather than only mounting when the menu itself has
  been opened at least once.
