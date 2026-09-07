import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../db';
import { notes, tags } from './index';

async function reset(): Promise<void> {
  await db.notes.clear();
  await db.noteTags.clear();
  await db.noteLinks.clear();
  await db.tags.clear();
  await db.syncState.clear();
}

describe('tags.affected', () => {
  beforeEach(reset);

  it('counts the notes and the tags a delete would touch', async () => {
    await notes.create('one\n#a/b');
    await notes.create('two\n#a/b/c');
    await notes.create('three\n#other');

    expect(await tags.affected('a/b')).toEqual({ noteCount: 2, tagCount: 2 });
  });

  it('counts a trashed note, because the rewrite will touch it', async () => {
    const trashed = await notes.create('gone\n#a/b');
    await notes.trash(trashed.id);

    expect((await tags.affected('a/b')).noteCount).toBe(1);
  });
});

describe('tags.remove', () => {
  beforeEach(reset);

  it('strips the tag and its descendants from every note', async () => {
    const one = await notes.create('one\n#a/b');
    const two = await notes.create('two #a/b/c here');

    expect(await tags.remove('a/b')).toEqual({ noteCount: 2 });
    expect((await db.notes.get(one.id))?.text).toBe('one');
    expect((await db.notes.get(two.id))?.text).toBe('two here');
    expect(await notes.allTagRows()).toEqual([]);
  });

  it('does NOT resurrect the tag when a trashed note is restored', async () => {
    // The hole this full scan exists to close: `trash` deletes a note's
    // noteTags rows but not the tag in its TEXT, and `restore` reindexes
    // from that text.
    const note = await notes.create('gone\n#a/b');
    await notes.trash(note.id);

    await tags.remove('a/b');
    await notes.restore(note.id);

    expect(await notes.tagsOf(note.id)).toEqual([]);
    expect((await db.notes.get(note.id))?.text).toBe('gone');
  });

  it('removes the whole subtree of TagMeta', async () => {
    await notes.create('one\n#a/b\n#a/b/c');
    await tags.setCollapsed('a/b', true);
    await tags.setIcon('a/b/c', 'star');

    await tags.remove('a/b');

    expect(await tags.getMeta('a/b')).toBeUndefined();
    expect(await tags.getMeta('a/b/c')).toBeUndefined();
  });

  it('leaves the vault untouched when the tag does not exist', async () => {
    const note = await notes.create('one\n#other');
    expect(await tags.remove('a/b')).toEqual({ noteCount: 0 });
    expect((await db.notes.get(note.id))?.text).toBe('one\n#other');
  });
});

describe('tags.rename', () => {
  beforeEach(reset);

  it('renames the tag and its descendants, and reindexes', async () => {
    const one = await notes.create('one\n#a/b');
    await notes.create('two\n#a/b/c');

    expect(await tags.rename('a/b', 'x')).toEqual({ noteCount: 2 });
    expect((await db.notes.get(one.id))?.text).toBe('one\n#x');
    expect((await notes.allTagRows()).map((r) => r.tag).sort()).toEqual(['x', 'x/c']);
  });

  it('preserves updatedAt, and marks dirty at that same value', async () => {
    const note = await notes.create('one\n#a/b');
    const before = (await db.notes.get(note.id))!.updatedAt;

    await tags.rename('a/b', 'x');

    const after = (await db.notes.get(note.id))!;
    expect(after.updatedAt).toBe(before);
    // The engine clears `dirty` only while the stored note still matches the
    // `markedAt` it pushed, so these two must agree or the row is re-pushed
    // on every sync forever.
    const row = await db.syncState.get(['note', note.id]);
    expect(row?.markedAt).toBe(before);
    expect(row?.dirty).toBe(1);
  });

  it('moves TagMeta to the new key and drops the old', async () => {
    await notes.create('one\n#a/b\n#a/b/c');
    await tags.setIcon('a/b', 'star');
    await tags.setCollapsed('a/b/c', true);

    await tags.rename('a/b', 'x');

    expect((await tags.getMeta('x'))?.iconKey).toBe('star');
    expect((await tags.getMeta('x/c'))?.collapsed).toBe(true);
    expect(await tags.getMeta('a/b')).toBeUndefined();
    expect(await tags.getMeta('a/b/c')).toBeUndefined();
  });

  it('merges into an existing tag, and the destination metadata wins', async () => {
    await notes.create('one\n#a/b');
    await notes.create('two\n#gemini');
    await tags.setIcon('gemini', 'sparkle');
    await tags.setIcon('a/b', 'star');

    await tags.rename('a/b', 'gemini');

    expect((await notes.allTagRows()).map((r) => r.tag).sort()).toEqual(['gemini', 'gemini']);
    expect((await tags.getMeta('gemini'))?.iconKey).toBe('sparkle');
  });

  it('refuses a name the grammar cannot write back', async () => {
    await notes.create('one\n#a/b');
    await expect(tags.rename('a/b', 'has#hash')).rejects.toThrow(/cannot be written/i);
  });

  it('skips a note that vanished from the read set, and still rewrites the survivors', async () => {
    // NOT a rollback test — genuine mid-transaction rollback is not covered
    // by any test in this file. `reindexNote` is not injectable from the
    // repository, so there is no seam to make a write throw part-way
    // through; atomicity here rests on Dexie's transaction guarantee, not on
    // anything asserted below. What this DOES prove: a note deleted out from
    // under the transaction's own read set is simply skipped, and the
    // surviving note is still rewritten correctly. `update` on a missing id
    // is a no-op in Dexie rather than a throw, which is why this cannot
    // exercise the failure path its old name implied.
    const one = await notes.create('one\n#a/b');
    const two = await notes.create('two\n#a/b');
    await db.notes.delete(two.id);

    await tags.rename('a/b', 'x');
    expect((await db.notes.get(one.id))?.text).toBe('one\n#x');
    expect(await db.notes.get(two.id)).toBeUndefined();
  });

  it('is a no-op when renaming a tag to itself', async () => {
    const note = await notes.create('one\n#a/b');
    expect(await tags.rename('a/b', 'a/b')).toEqual({ noteCount: 0 });
    expect((await db.notes.get(note.id))?.text).toBe('one\n#a/b');
  });
});
