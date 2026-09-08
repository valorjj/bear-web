import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../db';
import { parseLinks } from '../links';
import { parseTags } from '../tags';
import { notes, tags } from './index';
import { createTagsRepository } from './tags';

async function reset(): Promise<void> {
  await db.notes.clear();
  await db.noteTags.clear();
  await db.noteLinks.clear();
  await db.tags.clear();
  await db.syncState.clear();
}

describe('tagsRepository metadata', () => {
  // Restored after the S1 rewrite dropped them along with the old
  // `createTagsRepository(db)` construction. Nothing about the factory's new
  // deps object required deleting these: `removeMeta` and `allMeta`'s
  // sortOrder ordering (which `useTagTree` reads) were left untested
  // anywhere. They exercise the shared singleton now, like every other block
  // in this file.
  beforeEach(reset);

  it('returns undefined for a tag with no stored metadata', async () => {
    expect(await tags.getMeta('work')).toBeUndefined();
  });

  it('creates a metadata row on first write with sensible defaults', async () => {
    await tags.setCollapsed('work', true);

    expect(await tags.getMeta('work')).toEqual({
      tag: 'work',
      collapsed: true,
      iconKey: null,
      sortOrder: 0,
    });
  });

  it('updates one field without clobbering the others', async () => {
    await tags.setCollapsed('work', true);
    await tags.setIcon('work', 'briefcase');
    await tags.setSortOrder('work', 5);

    expect(await tags.getMeta('work')).toEqual({
      tag: 'work',
      collapsed: true,
      iconKey: 'briefcase',
      sortOrder: 5,
    });
  });

  it('clears an icon by setting it to null', async () => {
    await tags.setIcon('work', 'briefcase');
    await tags.setIcon('work', null);

    expect((await tags.getMeta('work'))?.iconKey).toBeNull();
  });

  it('lists all metadata rows ordered by sortOrder', async () => {
    await tags.setSortOrder('b', 2);
    await tags.setSortOrder('a', 1);

    expect((await tags.allMeta()).map((m) => m.tag)).toEqual(['a', 'b']);
  });

  it('removes a metadata row', async () => {
    await tags.setCollapsed('work', true);
    await tags.removeMeta('work');

    expect(await tags.getMeta('work')).toBeUndefined();
  });
});

describe('tags.affected', () => {
  beforeEach(reset);

  it('counts the notes and the tags a delete would touch', async () => {
    await notes.create('one\n#a/b');
    await notes.create('two\n#a/b/c');
    await notes.create('three\n#other');

    expect(await tags.affected('a/b')).toEqual({ noteCount: 2, tagCount: 2 });
  });

  it('counts the queried tag itself when no note text carries it', async () => {
    // A SYNTHETIC parent: `buildTagTree` renders a `project` row because
    // children exist, but no note writes `#project`. Counting only literal
    // names reported 2 here and the confirm read it as ONE sub-tag while two
    // were going.
    await notes.create('one\n#project/a');
    await notes.create('two\n#project/b');

    expect(await tags.affected('project')).toEqual({ noteCount: 2, tagCount: 3 });
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

  it('refuses a target containing whitespace, leaving the note untouched', async () => {
    // Not a UI concern the repository may delegate: `#my plan#` parses only
    // when the character after its closing `#` is a boundary, so writing it
    // before a full stop re-reads as the tag `my` and strands `plan#.` in the
    // user's prose. `canRenameTo` refuses it on both sides of the boundary.
    const note = await notes.create('done #work. next');
    await expect(tags.rename('work', 'my plan')).rejects.toThrow(/cannot be written/i);
    expect((await db.notes.get(note.id))?.text).toBe('done #work. next');
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

  it('counts the notes WRITTEN, not the notes selected', async () => {
    // `apply` skips a selected note whose rewrite changes nothing, and that
    // cannot arise through the real `parseTags` — a note is selected only
    // because it carries the tag. So this drives the branch through the seam
    // the factory already exposes, with a parser that over-selects. What is
    // pinned is that `noteCount` reports WRITES: `AppShell.renameTag`'s
    // self-limiting ref clear keys on `noteCount === 0` meaning "no
    // `tree.nodes` emission is coming", and a candidate count would be wrong
    // in exactly that direction.
    const carrier = await notes.create('one #a/b');
    const bystander = await notes.create('two, no tags at all');

    const overSelecting = createTagsRepository({
      db,
      parseTags: (text) => [...new Set([...parseTags(text), 'a/b'])],
      parseLinks,
    });

    expect(await overSelecting.rename('a/b', 'x')).toEqual({ noteCount: 1 });
    expect((await db.notes.get(carrier.id))?.text).toBe('one #x');
    expect((await db.notes.get(bystander.id))?.text).toBe('two, no tags at all');
  });

  it('renaming a tag into its own descendant keeps every metadata row', async () => {
    // Previously only hand-traced, and the trace was wrong. Processing `a`
    // first finds `a/b` still occupied, skips the put as a merge, deletes `a`,
    // and only then moves `a/b` to `a/b/b` — leaving the destination `a/b`
    // with no metadata at all. Deepest-first vacates `a/b` before `a` lands
    // on it.
    await notes.create('one #a #a/b');
    await tags.setIcon('a', 'star');
    await tags.setIcon('a/b', 'flag');

    await tags.rename('a', 'a/b');

    expect((await db.notes.get((await db.notes.toArray())[0]!.id))?.text).toBe('one #a/b #a/b/b');
    expect((await tags.getMeta('a/b'))?.iconKey).toBe('star');
    expect((await tags.getMeta('a/b/b'))?.iconKey).toBe('flag');
    expect(await tags.getMeta('a')).toBeUndefined();
  });

  it('is a no-op when renaming a tag to itself', async () => {
    const note = await notes.create('one\n#a/b');
    expect(await tags.rename('a/b', 'a/b')).toEqual({ noteCount: 0 });
    expect((await db.notes.get(note.id))?.text).toBe('one\n#a/b');
  });
});
