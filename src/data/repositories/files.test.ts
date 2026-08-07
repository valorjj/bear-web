import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createFilesRepository, type FilesRepository } from './files';

describe('filesRepository', () => {
  let db: BearDatabase;
  let files: FilesRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();

    let seq = 0;
    files = createFilesRepository({ db, generateId: () => `file-${++seq}` });
  });

  it('stores a blob and returns it unchanged', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    const record = await files.add('note-1', blob, 'text/plain');
    const found = await files.get(record.id);

    expect(found?.mime).toBe('text/plain');
    expect(await found?.blob.text()).toBe('hello');
  });

  it('lists only the files belonging to one note', async () => {
    await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.add('note-2', new Blob(['b']), 'text/plain');

    expect((await files.listForNote('note-1')).map((f) => f.id)).toEqual(['file-1']);
  });

  it('removes a single file', async () => {
    const record = await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.remove(record.id);

    expect(await files.get(record.id)).toBeUndefined();
  });

  it('removes every file for a note and reports the count', async () => {
    await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.add('note-1', new Blob(['b']), 'text/plain');
    await files.add('note-2', new Blob(['c']), 'text/plain');

    expect(await files.removeForNote('note-1')).toBe(2);
    expect(await files.listForNote('note-1')).toEqual([]);
    expect(await files.listForNote('note-2')).toHaveLength(1);
  });
});
