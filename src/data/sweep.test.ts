import { describe, expect, it, vi } from 'vitest';

import type { Note } from './types';
import { sweepBlankNotes } from './sweep';

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
