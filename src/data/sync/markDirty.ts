import type { BearDatabase } from '../db';
import type { SyncKind } from '../types';

/**
 * Records that a row differs from the server's copy.
 *
 * Called from INSIDE the repository's own Dexie transaction, never after it.
 * A separate write would leave a window where the note is saved and nothing
 * knows it needs pushing — and a crash inside that window loses the edit from
 * every other device permanently, with the local copy looking perfectly fine.
 *
 * `syncedRev` is preserved on an existing row: it is the `baseRev` the push
 * will send, and resetting it to 0 makes the server treat a known note as new,
 * which produces a `(conflict)` copy on every edit.
 */
export async function markDirty(
  db: BearDatabase,
  kind: SyncKind,
  key: string,
  markedAt: number,
): Promise<void> {
  const existing = await db.syncState.get([kind, key]);

  await db.syncState.put({
    kind,
    key,
    syncedRev: existing?.syncedRev ?? 0,
    dirty: 1,
    deleted: 0,
    markedAt,
  });
}

/**
 * Records a local purge.
 *
 * The bookkeeping row deliberately OUTLIVES the note: once the note row is
 * gone there is nothing else left that could tell the server to write a
 * tombstone, and without a tombstone the next pull resurrects the note on
 * every other device, forever.
 *
 * A note the server never saw (`syncedRev === 0`) is the exception — there is
 * nothing to delete there, so the row is dropped rather than queued.
 */
export async function markDeleted(
  db: BearDatabase,
  kind: SyncKind,
  key: string,
  markedAt: number,
): Promise<void> {
  const existing = await db.syncState.get([kind, key]);

  if (existing === undefined || existing.syncedRev === 0) {
    await db.syncState.delete([kind, key]);
    return;
  }

  await db.syncState.put({ ...existing, dirty: 1, deleted: 1, markedAt });
}

/**
 * Marks the whole database dirty. Used by adoption and by import.
 *
 * Returns the number of rows marked, so a caller can report "N notes added to
 * your account" from the same number the engine will push.
 */
export async function markAllDirty(db: BearDatabase, now: number): Promise<number> {
  const [notes, tagRows] = await Promise.all([db.notes.toArray(), db.tags.toArray()]);

  // Each note is stamped with its OWN `updatedAt`, never with `now`. The engine
  // clears `dirty` on accept only while the stored note still matches the
  // `markedAt` it pushed, so stamping the wall clock here would make that
  // comparison false on the first accept and on every accept after — dirty
  // pinned at 1, the whole library re-pushed every run, the server's rev
  // counter climbing without bound, and every other device re-pulling
  // everything each time. Both callers of this function (import, and guest
  // adoption) run at the FIRST sync a new user ever performs.
  for (const note of notes) await markDirty(db, 'note', note.id, note.updatedAt);

  // Tags have no `updatedAt` to preserve, so the wall clock is the only stamp
  // available for them — and the engine's tag accept branch DOES compare, so
  // this stamp matters. That branch guards against an edit landing mid-push
  // exactly as the note branch does, but with `markedAt` as its only witness:
  // it clears `dirty` only while the row's CURRENT `markedAt` still equals
  // the one `collect` snapshotted, and leaves the row dirty otherwise.
  // `TagMeta` carries no `updatedAt` to compare against, so if this stamp
  // ever stops being a faithful record of when the row was last marked, that
  // guard loses the only thing it can see.
  for (const row of tagRows) await markDirty(db, 'tag', row.tag, now);

  return notes.length + tagRows.length;
}
