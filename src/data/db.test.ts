import { describe, expect, it } from 'vitest';

import { BearDatabase } from './db';
import { createTestDatabase } from './testing';

describe('BearDatabase', () => {
  it('opens at schema version 5', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.verno).toBe(5);

    db.close();
  });

  it('declares all eight tables', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'files',
      'noteFolds',
      'noteLinks',
      'noteTags',
      'notes',
      'settings',
      'syncState',
      'tags',
    ]);

    db.close();
  });

  it('gives each test database an isolated store', async () => {
    const first = createTestDatabase();
    const second = createTestDatabase();
    await first.open();
    await second.open();

    await first.settings.put({ key: 'theme', value: 'dark' });

    expect(await second.settings.get('theme')).toBeUndefined();

    first.close();
    second.close();
  });

  it('round-trips a note through the notes table', async () => {
    const db = createTestDatabase();
    await db.open();

    await db.notes.put({
      id: 'n1',
      title: 'Hello',
      text: '# Hello\n\nbody',
      createdAt: 1000,
      updatedAt: 1000,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    const found = await db.notes.get('n1');
    expect(found?.text).toBe('# Hello\n\nbody');

    db.close();
  });

  it('carries a syncState table keyed by kind and key', async () => {
    const database = new BearDatabase(`test-${crypto.randomUUID()}`);
    await database.open();

    await database.syncState.put({
      kind: 'note',
      key: 'note-1',
      syncedRev: 0,
      dirty: 1,
      deleted: 0,
      markedAt: 42,
    });

    const found = await database.syncState.get(['note', 'note-1']);
    expect(found?.markedAt).toBe(42);

    // The dirty index is what the push loop queries. It must be a NUMBER:
    // IndexedDB rejects boolean keys outright, exactly as it does for `pinned`.
    const dirty = await database.syncState.where('dirty').equals(1).toArray();
    expect(dirty).toHaveLength(1);

    database.close();
  });

  it('declares version 5, which is IndexedDB version 50', async () => {
    // e2e/fixtures/seed.ts opens at the RAW IndexedDB number and must move with
    // this. Seeding at the wrong number leaves a connection blocking the
    // upgrade forever and the app boots to a bare <div id="root"> with no error.
    //
    // This test failing during a version bump is it doing its job: the bump is
    // the licensed edit, and the seed moving in the SAME commit is the rule it
    // exists to enforce. L2 raised it from 4 to 5 for the noteLinks backlinks
    // index.
    const database = new BearDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    expect(database.verno).toBe(5);
    database.close();
  });
});
