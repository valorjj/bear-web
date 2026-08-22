import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { markAllDirty, markDeleted, markDirty } from './markDirty';

describe('markDirty', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = new BearDatabase(`test-${crypto.randomUUID()}`);
    await db.open();
  });

  it('creates a dirty row for a note that has never synced', async () => {
    await markDirty(db, 'note', 'n1', 100);

    expect(await db.syncState.get(['note', 'n1'])).toEqual({
      kind: 'note',
      key: 'n1',
      syncedRev: 0,
      dirty: 1,
      deleted: 0,
      markedAt: 100,
    });
  });

  it('keeps syncedRev when re-marking an already-synced row', async () => {
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 7,
      dirty: 0,
      deleted: 0,
      markedAt: 1,
    });

    await markDirty(db, 'note', 'n1', 200);

    const row = await db.syncState.get(['note', 'n1']);
    // Losing this is how a re-edited note pushes with baseRev 0 and is treated
    // as brand new by a server that already holds it at rev 7 — a guaranteed
    // conflict copy on every single edit.
    expect(row?.syncedRev).toBe(7);
    expect(row?.dirty).toBe(1);
    expect(row?.markedAt).toBe(200);
  });

  it('marks a purge as deleted and dirty, and keeps the row', async () => {
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 7,
      dirty: 0,
      deleted: 0,
      markedAt: 1,
    });

    await markDeleted(db, 'note', 'n1', 300);

    const row = await db.syncState.get(['note', 'n1']);
    expect(row).toMatchObject({ deleted: 1, dirty: 1, syncedRev: 7 });
  });

  it('does not create a tombstone row for a note that never reached the server', async () => {
    // Nothing to tell the server about: it has never heard of this note, and a
    // tombstone for it would be a delete of something that does not exist.
    await markDirty(db, 'note', 'n1', 100);
    await markDeleted(db, 'note', 'n1', 300);

    expect(await db.syncState.get(['note', 'n1'])).toBeUndefined();
  });

  it('marks every note and tag dirty', async () => {
    await db.notes.bulkAdd([
      {
        id: 'n1',
        title: '',
        text: '',
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
      {
        id: 'n2',
        title: '',
        text: '',
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ]);
    await db.tags.add({ tag: 'work', collapsed: false, iconKey: null, sortOrder: 0 });

    expect(await markAllDirty(db, 500)).toBe(3);
    expect(await db.syncState.where('dirty').equals(1).count()).toBe(3);
  });
});
