import { describe, expect, it } from 'vitest';

import { createTestDatabase } from './testing';

describe('BearDatabase', () => {
  it('opens at schema version 1', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.verno).toBe(1);

    db.close();
  });

  it('declares all five tables', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'files',
      'noteTags',
      'notes',
      'settings',
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
});
