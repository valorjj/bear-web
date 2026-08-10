import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { parseTags } from '../tags';
import { createNotesRepository, type NotesRepository } from './notes';

/** A fake parser: every word starting with `#` is a tag. Not the real M5 parser. */
const fakeParseTags = (text: string): string[] => [...text.matchAll(/#([\w/]+)/g)].map((m) => m[1]);

describe('notesRepository', () => {
  let db: BearDatabase;
  let notes: NotesRepository;
  let clock: number;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    clock = 1000;

    let seq = 0;
    notes = createNotesRepository({
      db,
      parseTags: fakeParseTags,
      now: () => clock,
      generateId: () => `id-${++seq}`,
    });
  });

  it('creates an empty note with derived defaults', async () => {
    const note = await notes.create();

    expect(note.id).toBe('id-1');
    expect(note.text).toBe('');
    expect(note.title).toBe('');
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(note.pinned).toBe(false);
    expect(note.trashedAt).toBeNull();
    expect(note.archivedAt).toBeNull();
  });

  it('derives the title from the text on save', async () => {
    const note = await notes.create();
    clock = 2000;

    const saved = await notes.save(note.id, '# Groceries\n\nmilk');

    expect(saved.title).toBe('Groceries');
    expect(saved.updatedAt).toBe(2000);
    expect(saved.createdAt).toBe(1000);
  });

  it('rejects saving a note that does not exist', async () => {
    await expect(notes.save('missing', 'text')).rejects.toThrow();
  });

  it('moves a note to trash and back without losing content', async () => {
    const note = await notes.create('keep me');
    clock = 3000;

    await notes.trash(note.id);
    expect((await notes.get(note.id))?.trashedAt).toBe(3000);

    await notes.restore(note.id);
    const restored = await notes.get(note.id);
    expect(restored?.trashedAt).toBeNull();
    expect(restored?.text).toBe('keep me');
  });

  it('excludes trashed notes from listActive and includes them in listTrashed', async () => {
    const kept = await notes.create('kept');
    const tossed = await notes.create('tossed');
    await notes.trash(tossed.id);

    expect((await notes.listActive()).map((n) => n.id)).toEqual([kept.id]);
    expect((await notes.listTrashed()).map((n) => n.id)).toEqual([tossed.id]);
  });

  it('orders listActive by updatedAt, newest first', async () => {
    const first = await notes.create('first');
    clock = 2000;
    const second = await notes.create('second');
    clock = 3000;
    await notes.save(first.id, 'first again');

    expect((await notes.listActive()).map((n) => n.id)).toEqual([first.id, second.id]);
  });

  it('toggles pinned', async () => {
    const note = await notes.create();

    await notes.setPinned(note.id, true);
    expect((await notes.get(note.id))?.pinned).toBe(true);

    await notes.setPinned(note.id, false);
    expect((await notes.get(note.id))?.pinned).toBe(false);
  });

  it('purges a single note permanently', async () => {
    const note = await notes.create('doomed');
    await notes.purge(note.id);

    expect(await notes.get(note.id)).toBeUndefined();
  });

  it('empties the trash and leaves active notes alone', async () => {
    const kept = await notes.create('kept');
    const a = await notes.create('a');
    const b = await notes.create('b');
    await notes.trash(a.id);
    await notes.trash(b.id);

    expect(await notes.emptyTrash()).toBe(2);
    expect((await notes.listActive()).map((n) => n.id)).toEqual([kept.id]);
    expect(await notes.listTrashed()).toEqual([]);
  });

  it('indexes tags parsed from the note text on save', async () => {
    const note = await notes.create();
    await notes.save(note.id, 'shopping #food and #work/urgent');

    expect((await notes.tagsOf(note.id)).sort()).toEqual(['food', 'work/urgent']);
  });

  it('removes tags from the index when they leave the text', async () => {
    const note = await notes.create('#alpha #beta');
    expect((await notes.tagsOf(note.id)).sort()).toEqual(['alpha', 'beta']);

    await notes.save(note.id, '#alpha only');
    expect(await notes.tagsOf(note.id)).toEqual(['alpha']);
  });

  it('deduplicates a tag repeated in one note', async () => {
    const note = await notes.create('#same and #same again');

    expect(await notes.tagsOf(note.id)).toEqual(['same']);
  });

  it('drops the tag index entries when a note is purged', async () => {
    const note = await notes.create('#gone');
    await notes.purge(note.id);

    expect(await db.noteTags.where('noteId').equals(note.id).count()).toBe(0);
  });

  it('rebuilds the entire tag index from note text alone', async () => {
    const a = await notes.create('#one');
    const b = await notes.create('#two #three');

    // Simulate corruption: wipe the derived index entirely.
    await db.noteTags.clear();
    expect(await notes.tagsOf(a.id)).toEqual([]);

    const rebuilt = await notes.rebuildTagIndex();

    expect(rebuilt).toBe(3);
    expect(await notes.tagsOf(a.id)).toEqual(['one']);
    expect((await notes.tagsOf(b.id)).sort()).toEqual(['three', 'two']);
  });

  it('keeps trashed notes out of the tag index rebuild', async () => {
    const active = await notes.create('#live');
    const trashed = await notes.create('#dead');
    await notes.trash(trashed.id);

    await db.noteTags.clear();
    await notes.rebuildTagIndex();

    expect(await notes.tagsOf(active.id)).toEqual(['live']);
    expect(await notes.tagsOf(trashed.id)).toEqual([]);
  });

  it('recreates tag rows on restore, even after a rebuild dropped them', async () => {
    const note = await notes.create('#work item');
    expect(await notes.tagsOf(note.id)).toEqual(['work']);

    await notes.trash(note.id);
    await notes.rebuildTagIndex();

    await notes.restore(note.id);
    expect(await notes.tagsOf(note.id)).toEqual(['work']);
  });

  it('keeps the incrementally-maintained tag index identical to a full rebuild across the whole lifecycle', async () => {
    async function assertIndexMatchesRebuild(): Promise<void> {
      const before = await db.noteTags.toArray();
      await notes.rebuildTagIndex();
      const after = await db.noteTags.toArray();

      const normalize = (rows: { noteId: string; tag: string }[]) =>
        rows
          .map((r) => `${r.noteId}:${r.tag}`)
          .sort()
          .join(',');

      expect(normalize(before)).toBe(normalize(after));
    }

    const note = await notes.create('#alpha item');
    await assertIndexMatchesRebuild();

    await notes.save(note.id, '#alpha #beta item');
    await assertIndexMatchesRebuild();

    await notes.trash(note.id);
    await assertIndexMatchesRebuild();

    await notes.restore(note.id);
    await assertIndexMatchesRebuild();

    await notes.trash(note.id);
    await assertIndexMatchesRebuild();
  });

  it('treats a note trashed at epoch 0 as trashed', async () => {
    clock = 0;
    const note = await notes.create('gone at zero');
    await notes.trash(note.id);

    expect((await notes.listTrashed()).map((n) => n.id)).toEqual([note.id]);
    expect((await notes.listActive()).map((n) => n.id)).toEqual([]);

    expect(await notes.emptyTrash()).toBe(1);
    expect(await notes.get(note.id)).toBeUndefined();
  });

  it('resolves silently when purging a note that does not exist', async () => {
    await expect(notes.purge('does-not-exist')).resolves.toBeUndefined();
  });

  describe('tag queries', () => {
    it('listByTag includes descendants but not sibling prefixes', async () => {
      const repo = createNotesRepository({ db, parseTags });

      const parent = await repo.create('#work');
      const child = await repo.create('#work/urgent');
      await repo.create('#workflow');
      await repo.create('no tags');

      const found = await repo.listByTag('work');
      expect(found.map((n) => n.id).sort()).toEqual([parent.id, child.id].sort());
    });

    it('listByTag excludes trashed notes', async () => {
      const repo = createNotesRepository({ db, parseTags });

      const kept = await repo.create('#work');
      const gone = await repo.create('#work');
      await repo.trash(gone.id);

      const found = await repo.listByTag('work');
      expect(found.map((n) => n.id)).toEqual([kept.id]);
    });

    it('listByTag excludes a trashed note even when its noteTags row was never removed', async () => {
      // trash() already removes the row, so this cannot happen through the
      // repository. It simulates a desync directly — a stale row surviving a
      // rebuild that ran while the note was trashed, or a bug in a future
      // change to trash()/restore() — to prove listByTag's own filter is a
      // real, load-bearing second guard, not just a mirror of trash()'s.
      const repo = createNotesRepository({ db, parseTags });

      const kept = await repo.create('#work');
      const trashedNote = await repo.create('#work');
      await repo.trash(trashedNote.id);
      await db.noteTags.put({ noteId: trashedNote.id, tag: 'work' });

      const found = await repo.listByTag('work');
      expect(found.map((n) => n.id)).toEqual([kept.id]);
    });

    it('listByTag returns most recently updated first', async () => {
      let clock = 1000;
      const repo = createNotesRepository({ db, parseTags, now: () => (clock += 10) });

      const first = await repo.create('#work');
      const second = await repo.create('#work');

      const found = await repo.listByTag('work');
      expect(found.map((n) => n.id)).toEqual([second.id, first.id]);
    });

    it('allTagRows returns one row per note per tag', async () => {
      const repo = createNotesRepository({ db, parseTags });

      const note = await repo.create('#work #home');
      const rows = await repo.allTagRows();

      expect(rows.map((r) => `${r.noteId}:${r.tag}`).sort()).toEqual(
        [`${note.id}:work`, `${note.id}:home`].sort(),
      );
    });
  });

  describe('rebuild determinism', () => {
    it('produces an identical row set when run twice', async () => {
      const repo = createNotesRepository({ db, parseTags });
      await repo.create('#Work/Urgent and #home');
      await repo.create('#work/urgent');

      await repo.rebuildTagIndex();
      const first = (await repo.allTagRows()).map((r) => `${r.noteId}:${r.tag}`).sort();

      await repo.rebuildTagIndex();
      const second = (await repo.allTagRows()).map((r) => `${r.noteId}:${r.tag}`).sort();

      expect(second).toEqual(first);
    });

    it('produces an identical row set regardless of note insertion order', async () => {
      const texts = ['#Work', '#work/urgent', '#WORK', 'untagged'];

      const build = async (order: number[]): Promise<string[]> => {
        await db.notes.clear();
        await db.noteTags.clear();
        const repo = createNotesRepository({
          db,
          parseTags,
          generateId: (() => {
            let n = 0;
            return () => `note-${order[n++]}`;
          })(),
        });
        for (const index of order) await repo.create(texts[index]);
        await repo.rebuildTagIndex();
        return (await repo.allTagRows()).map((r) => `${r.noteId}:${r.tag}`).sort();
      };

      expect(await build([3, 1, 0, 2])).toEqual(await build([0, 1, 2, 3]));
    });
  });
});
