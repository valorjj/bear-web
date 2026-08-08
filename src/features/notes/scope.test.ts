import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';

import { listForScope, type ScopeLister } from './scope';

function note(id: string): Note {
  return {
    id,
    title: id,
    text: id,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
}

describe('listForScope', () => {
  it('asks for active notes in the active scope', async () => {
    const repository: ScopeLister = {
      listActive: vi.fn().mockResolvedValue([note('a')]),
      listTrashed: vi.fn().mockResolvedValue([note('t')]),
    };

    await expect(listForScope('active', repository)).resolves.toEqual([note('a')]);
    expect(repository.listTrashed).not.toHaveBeenCalled();
  });

  it('asks for trashed notes in the trashed scope', async () => {
    const repository: ScopeLister = {
      listActive: vi.fn().mockResolvedValue([note('a')]),
      listTrashed: vi.fn().mockResolvedValue([note('t')]),
    };

    await expect(listForScope('trashed', repository)).resolves.toEqual([note('t')]);
    expect(repository.listActive).not.toHaveBeenCalled();
  });
});
