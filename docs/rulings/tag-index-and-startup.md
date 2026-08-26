# The tag index, persistence, and startup

Governs how the derived `noteTags` index is built and kept honest, and how the
three unawaited boot tasks — tag-index migration, blank-note sweep, persistent
storage — must behave so none of them can ever brick the app or destroy a note.

**Trigger:** any change to `src/data/migrations.ts` (`runMigrations`,
`TAG_INDEX_VERSION`, `runStartupMigrations`), `src/data/sweep.ts`
(`sweepBlankNotes`, `SweepDeps.createdBefore`, `runStartupSweep`),
`src/data/persist.ts` (`requestPersistentStorage`, `persistStorage`),
`src/data/backup.ts` (`importDatabase`, `assertBundle`), `src/data/db.ts`'s
`stores({...})` index strings, the `noteTags` writes in
`src/data/repositories/notes.ts` (`reindex`, `trash`, `restore`, `purge`,
`emptyTrash`, `rebuildTagIndex`), or the boot sequence in `src/main.tsx`
(`BOOT_AT`, the `openDatabase().then` body). Also: a new `db.version(n)` with
an `.upgrade()` hook, a new `.where('pinned')` or `.above(0)` on `trashedAt`,
or an `onError` callback losing its `try`/`catch`.

- **The tag-index rebuild is a settings marker, never a Dexie `upgrade()`
  hook.** A throw inside a versioning transaction means the database never
  opens — the app is bricked with the user's notes on disk and unreachable.
  With the marker a throw costs an empty index and the version is deliberately
  not recorded, so the next launch retries. `runMigrations` must never reject —
  that includes a caller-supplied `onError` that itself throws, which is
  guarded separately — and `TAG_INDEX_VERSION` is bumped whenever the parser's
  output changes.

- **`persistStorage` checks `persisted()` before it ever calls `persist()`, and
  only asks once the database already holds a note.** The order is the whole
  design. `persisted()` only reads state; `persist()` raises a permission
  doorhanger in Firefox, and asking a first-time visitor to grant persistent
  storage before they have written anything is the moment they are most likely
  to refuse — a refusal that sticks. So notes from a user's very first session
  stay evictable until their next launch, which is safe because eviction does
  not happen mid-session. Chrome and Safari never prompt and decide from
  engagement heuristics, which the same gating happens to favour. Do not "fix"
  this by requesting at boot unconditionally. Like `runMigrations`, it never
  rejects, is feature-detected rather than assumed (`navigator.storage` is
  absent in older Safari and some webviews), and guards its own `onError`.

- **`importDatabase` ignores the bundle's `noteTags` rows and rebuilds**, via an
  injected callback. The index is derived; trusting a file's copy contradicts
  that, and it is what made a pre-M5 backup restore an empty index. `backup.ts`
  still has no tag parser and must not acquire one.

- **IndexedDB cannot index booleans or nulls.** `pinned` is unindexed and filtered
  in memory — a `.where('pinned')` query throws at runtime, not compile time. The
  `trashedAt` index contains _only_ trashed notes, because IndexedDB omits
  null-valued records; that is why `.aboveOrEqual(0)` is the correct idiom.

- **The `noteTags` index reflects active notes only**, consistently across `trash`,
  `restore`, and `rebuildTagIndex`. Dropping the table and rebuilding from
  `notes.text` must always be safe.

- **Import is replace-only**, and validates fully before clearing anything, so a
  rejected import cannot destroy existing data.

- **The startup sweep's three content gates are load-bearing but not
  sufficient — a fourth, `createdBefore`, closes a real race.**
  `createdAt === updatedAt` makes a note the user has typed into unreachable
  even if the emptiness check is wrong — the M4 shape where a truncation
  reached `notes.purge`. But the sweep is unawaited and runs after React has
  already mounted and made the app interactive, so a note created in that
  window (widened to seconds by a tag-index rebuild) has empty text, no
  `trashedAt`, and `createdAt === updatedAt` — it passes all three content
  gates legitimately, and the sweep would purge work in progress out from
  under a pending autosave. `SweepDeps.createdBefore` is captured at module
  scope in `main.tsx` before anything else can run, and the sweep skips any
  note whose `createdAt` is at or after it. Like `runMigrations` and
  `persistStorage`, the sweep never rejects, including when `onError` throws;
  a single note's purge throwing is now also caught per-note so it neither
  aborts the rest of the sweep nor gets silently counted as succeeding.

- **The sweep runs after the tag-index rebuild resolves, not concurrently.**
  Both write inside transactions over `notes`; sequencing removes the question
  of what a rebuild sees mid-purge.



- **`db.version(4)` is IndexedDB version 40, and `e2e/fixtures/seed.ts` moved
  with it in the same commit.** K1 added image metadata to `files`. No
  `.upgrade()` hook, and that is safe rather than lazy: the `files` repository
  had no call sites before K1, so no row of that shape was ever written.
  `db.test.ts` pins the number and failing on a bump is it working — the bump
  is the licensed edit, and the seed moving with it is the rule it enforces.

- **`runStartupFileSweep` is sequenced AFTER `runStartupSweep`, not alongside
  it.** The blank-note sweep purges notes, and purging already reclaims their
  files, so running both at once would have the image sweep reading notes the
  other is deleting.
