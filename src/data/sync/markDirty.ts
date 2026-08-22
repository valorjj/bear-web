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
  const [noteIds, tagRows] = await Promise.all([
    db.notes.toCollection().primaryKeys(),
    db.tags.toArray(),
  ]);

  for (const id of noteIds) await markDirty(db, 'note', id as string, now);
  for (const row of tagRows) await markDirty(db, 'tag', row.tag, now);

  return noteIds.length + tagRows.length;
}
