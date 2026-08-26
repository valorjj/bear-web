import { describe, expect, it, vi } from 'vitest';

import type { Note } from './types';
import { sweepBlankNotes, sweepOrphanFiles } from './sweep';

const note = (overrides: Partial<Note>): Note => ({
  id: 'n',
  title: '',
  text: '',
  createdAt: 100,
  updatedAt: 100,
  pinned: false,
  trashedAt: null,
  archivedAt: null,
  ...overrides,
});

function deps(candidates: Note[], overrides: Partial<Parameters<typeof sweepBlankNotes>[0]> = {}) {
  return {
    listCandidates: vi.fn(async () => candidates),
    purge: vi.fn(async () => {}),
    // Comfortably above the fixtures' createdAt of 100, so tests that don't
    // care about the boot boundary aren't accidentally gated by it.
    createdBefore: 100_000,
    onError: vi.fn(),
    ...overrides,
  };
}

describe('sweepBlankNotes', () => {
  it('purges a blank, never-saved, untrashed note', async () => {
    const d = deps([note({ id: 'blank' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(1);
    expect(d.purge).toHaveBeenCalledWith('blank');
  });

  it('spares a note with text', async () => {
    const d = deps([note({ id: 'kept', text: 'hello' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('spares a blank note the user has saved at least once', async () => {
    // The gate that makes this safe: `save` always writes a fresh updatedAt,
    // so this note has been through the editor. Even if the emptiness check
    // were wrong, this note is unreachable.
    const d = deps([note({ id: 'edited', createdAt: 100, updatedAt: 200 })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('spares a blank note in the trash', async () => {
    // It is in the user's trash; removing it silently would be a deletion
    // they never asked for and cannot see happen.
    const d = deps([note({ id: 'trashed', trashedAt: 500 })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('purges several and reports the count', async () => {
    const d = deps([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c', text: 'x' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(2);
  });

  it('never rejects when listing throws', async () => {
    const boom = new Error('nope');
    const d = deps([], {
      listCandidates: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.onError).toHaveBeenCalledWith(boom);
  });

  it('never rejects when a purge throws', async () => {
    const d = deps([note({ id: 'a' })], {
      purge: vi.fn(async () => {
        throw new Error('locked');
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
  });

  it('reports a failed purge and keeps sweeping the rest', async () => {
    // The count must reflect what actually happened: one purge throws, the
    // other succeeds, so the total is 1 — not 0 (abort-on-first-error) and
    // not 2 (silently counting the failure as a success).
    const purge = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    const d = deps([note({ id: 'a' }), note({ id: 'b' })], { purge });
    await expect(sweepBlankNotes(d)).resolves.toBe(1);
    expect(purge).toHaveBeenCalledWith('a');
    expect(purge).toHaveBeenCalledWith('b');
    expect(purge).toHaveBeenCalledTimes(2);
    expect(d.onError).toHaveBeenCalled();
  });

  it('spares a note created after the sweep was decided on', async () => {
    // The race: React mounts before the sweep runs, so a note created in that
    // window passes all three content gates legitimately. Without this bound
    // the sweep destroys work in progress and the pending save then rejects.
    const d = deps([note({ id: 'fresh', createdAt: 5000, updatedAt: 5000 })], {
      createdBefore: 1000,
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('excludes a note created at exactly the boundary instant', async () => {
    // `>=`, not `>`: a note stamped at the same millisecond as boot cannot be
    // proven to predate it, so it must be spared too.
    const d = deps([note({ id: 'edge', createdAt: 1000, updatedAt: 1000 })], {
      createdBefore: 1000,
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('never rejects when onError itself throws', async () => {
    const d = deps([], {
      listCandidates: vi.fn(async () => {
        throw new Error('nope');
      }),
      onError: vi.fn(() => {
        throw new Error('logger exploded');
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
  });
});

describe('sweepOrphanFiles', () => {
  const base = { createdBefore: 1000, remove: vi.fn(async () => {}) };

  function file(id: string, noteId = 'n1', createdAt = 500) {
    return { id, noteId, createdAt };
  }

  it('removes a file no note references any more', async () => {
    const remove = vi.fn(async () => {});

    const count = await sweepOrphanFiles({
      ...base,
      remove,
      listFiles: async () => [file('a')],
      noteText: async () => 'the image is gone from this text',
    });

    expect(count).toBe(1);
    expect(remove).toHaveBeenCalledWith('a');
  });

  it('keeps a file the note still references', async () => {
    const remove = vi.fn(async () => {});

    await sweepOrphanFiles({
      ...base,
      remove,
      listFiles: async () => [file('a')],
      noteText: async () => 'before ![](files/a.webp) after',
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a file whose note is gone', async () => {
    // `notes.purge` already reclaims a purged note's files; this is the
    // belt-and-braces case where that did not complete.
    const remove = vi.fn(async () => {});

    await sweepOrphanFiles({
      ...base,
      remove,
      listFiles: async () => [file('a')],
      noteText: async () => null,
    });

    expect(remove).toHaveBeenCalledWith('a');
  });

  it('never touches a file stored after the sweep was decided on', async () => {
    // The time-of-check gate. The sweep is unawaited and the app is
    // interactive while it runs, so an image pasted in that window must be out
    // of reach — the same hazard `createdBefore` closes for blank notes.
    const remove = vi.fn(async () => {});

    await sweepOrphanFiles({
      ...base,
      remove,
      listFiles: async () => [file('a', 'n1', 1500)],
      noteText: async () => 'no reference',
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it('reads each note once however many files it owns', async () => {
    const noteText = vi.fn(async () => 'no references at all');

    await sweepOrphanFiles({
      ...base,
      listFiles: async () => [file('a'), file('b'), file('c')],
      noteText,
    });

    expect(noteText).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one removal throws, and reports it', async () => {
    const onError = vi.fn();
    const remove = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('locked');
    });

    const count = await sweepOrphanFiles({
      ...base,
      remove,
      onError,
      listFiles: async () => [file('a'), file('b')],
      noteText: async () => 'nothing referenced',
    });

    expect(count).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never rejects when listing fails', async () => {
    const onError = vi.fn();

    const count = await sweepOrphanFiles({
      ...base,
      onError,
      listFiles: async () => {
        throw new Error('database gone');
      },
      noteText: async () => null,
    });

    expect(count).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
