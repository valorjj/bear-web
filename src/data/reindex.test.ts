import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from './db';
import { parseLinks } from './links';
import { reindexNote } from './reindex';
import { parseTags } from './tags';
import { createTestDatabase } from './testing';

describe('reindexNote', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
  });

  it('writes BOTH derived tables from one call', async () => {
    await reindexNote(db, 'n1', 'A #work note linking [[Other Note]].', parseTags, parseLinks);

    expect(await db.noteTags.where('noteId').equals('n1').toArray()).toHaveLength(1);
    expect((await db.noteLinks.where('noteId').equals('n1').toArray())[0]?.toTitle).toBe(
      'other note',
    );
  });

  it('drops a self-link, which is noise rather than information', async () => {
    // The note is titled "Self"; a link to itself must not appear in its own
    // backlinks list.
    await reindexNote(
      db,
      'n1',
      'Self\n\nsee [[Self]] and [[Other]]',
      parseTags,
      parseLinks,
      'Self',
    );

    const rows = await db.noteLinks.where('noteId').equals('n1').toArray();
    expect(rows.map((r) => r.toTitle)).toEqual(['other']);
  });

  it('replaces rows rather than accumulating them', async () => {
    await reindexNote(db, 'n1', '[[a]] [[b]]', parseTags, parseLinks);
    await reindexNote(db, 'n1', '[[c]]', parseTags, parseLinks);

    const rows = await db.noteLinks.where('noteId').equals('n1').toArray();
    expect(rows.map((r) => r.toTitle)).toEqual(['c']);
  });
});
