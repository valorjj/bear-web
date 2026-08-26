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
    files = createFilesRepository({ db, generateId: () => `file-${++seq}`, now: () => 5000 });
  });

  it('stores a blob and returns it unchanged', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    const record = await files.add('note-1', blob, {
      mime: 'text/plain',
      width: 0,
      height: 0,
    });
    const found = await files.get(record.id);

    expect(found?.mime).toBe('text/plain');
    expect(await found?.blob.text()).toBe('hello');
  });

  it('records the dimensions, size and time, so nothing downstream reads a blob to learn them', async () => {
    const blob = new Blob([new Uint8Array(1234)], { type: 'image/webp' });

    const record = await files.add('n1', blob, { mime: 'image/webp', width: 800, height: 600 });

    expect(record.width).toBe(800);
    expect(record.height).toBe(600);
    // DERIVED, never taken from the caller: the blob already knows its size,
    // and a caller-supplied number is a second source of truth for one fact.
    expect(record.bytes).toBe(1234);
    expect(record.createdAt).toBe(5000);
  });

  it('lists only the files belonging to one note', async () => {
    await files.add('note-1', new Blob(['a']), { mime: 'text/plain', width: 0, height: 0 });
    await files.add('note-2', new Blob(['b']), { mime: 'text/plain', width: 0, height: 0 });

    expect((await files.listForNote('note-1')).map((f) => f.id)).toEqual(['file-1']);
  });

  it('removes a single file', async () => {
    const record = await files.add('note-1', new Blob(['a']), {
      mime: 'text/plain',
      width: 0,
      height: 0,
    });
    await files.remove(record.id);

    expect(await files.get(record.id)).toBeUndefined();
  });

  it('removes every file for a note and reports the count', async () => {
    await files.add('note-1', new Blob(['a']), { mime: 'text/plain', width: 0, height: 0 });
    await files.add('note-1', new Blob(['b']), { mime: 'text/plain', width: 0, height: 0 });
    await files.add('note-2', new Blob(['c']), { mime: 'text/plain', width: 0, height: 0 });

    expect(await files.removeForNote('note-1')).toBe(2);
    expect(await files.listForNote('note-1')).toEqual([]);
    expect(await files.listForNote('note-2')).toHaveLength(1);
  });
});
