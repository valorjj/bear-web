import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportDatabase, importDatabase } from '../backup';
import { BearDatabase } from '../db';
import { createFoldsRepository } from './folds';
import { createNotesRepository } from './notes';

function freshDb(): BearDatabase {
  return new BearDatabase(`folds-test-${Math.random().toString(36).slice(2)}`);
}

let db: BearDatabase;

beforeEach(() => {
  db = freshDb();
});

describe('the folds repository', () => {
  it('returns an empty list for a note that has never been folded', async () => {
    const folds = createFoldsRepository(db);

    expect(await folds.get('missing')).toEqual([]);
  });

  it('round-trips a fold set', async () => {
    const folds = createFoldsRepository(db);
    await folds.set('n1', ['2:0:Alpha', '3:1:Beta']);

    expect(await folds.get('n1')).toEqual(['2:0:Alpha', '3:1:Beta']);
  });

  it('replaces rather than merges, so unfolding everything really clears it', async () => {
    const folds = createFoldsRepository(db);
    await folds.set('n1', ['2:0:Alpha']);
    await folds.set('n1', []);

    expect(await folds.get('n1')).toEqual([]);
  });

  it('purging a note clears its folds, so the table cannot outlive its notes', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });

    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);
    await notes.purge(note.id);

    expect(await folds.get(note.id)).toEqual([]);
  });

  it('emptying the trash clears folds for every note it purges', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });

    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);
    await notes.trash(note.id);
    await notes.emptyTrash();

    expect(await folds.get(note.id)).toEqual([]);
  });
});

describe('fold state and the backup bundle', () => {
  it('is absent from an exported bundle, because it is view state', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });
    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);

    const bundle = await exportDatabase(db);

    expect(Object.keys(bundle)).not.toContain('noteFolds');
  });

  // `importDatabase` clears `noteFolds` alongside the other tables even
  // though the bundle never carries it (see the test above): without this,
  // fold rows from the database being REPLACED survive the import as
  // orphans, and a restored note whose id happens to match one reopens with
  // a section folded that the user never folded in that database. Not
  // merely "the bundle omits folds" — the destination table must actually
  // end up empty.
  it('clears existing fold rows on import, even though the bundle never carries them', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });
    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);

    expect(await folds.get(note.id)).toEqual(['1:0:A']);

    const bundle = await exportDatabase(db);
    await importDatabase(db, JSON.parse(JSON.stringify(bundle)), {
      rebuildTagIndex: vi.fn(async () => 0),
    });

    expect(await folds.get(note.id)).toEqual([]);
    expect(await db.noteFolds.count()).toBe(0);
  });
});
