import { beforeEach, describe, expect, it } from 'vitest';

import { exportDatabase } from '../backup';
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
});
