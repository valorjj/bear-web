import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';

import { ACTIVE_SCOPE, listForScope, scopeKey, tagScope, TRASHED_SCOPE } from './scope';

const note = (id: string): Note => ({
  id,
  title: id,
  text: id,
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  trashedAt: null,
  archivedAt: null,
});

function lister() {
  return {
    listActive: vi.fn(async () => [note('active')]),
    listTrashed: vi.fn(async () => [note('trashed')]),
    listByTag: vi.fn(async () => [note('tagged')]),
  };
}

describe('scopeKey', () => {
  it('is stable for each scope', () => {
    expect(scopeKey(ACTIVE_SCOPE)).toBe('active');
    expect(scopeKey(TRASHED_SCOPE)).toBe('trashed');
    expect(scopeKey(tagScope('work/urgent'))).toBe('tag:work/urgent');
  });

  it('distinguishes a tag from a same-named builtin', () => {
    expect(scopeKey(tagScope('active'))).not.toBe(scopeKey(ACTIVE_SCOPE));
  });

  it('is equal for two separately constructed identical tag scopes', () => {
    expect(scopeKey(tagScope('work'))).toBe(scopeKey(tagScope('work')));
  });
});

describe('listForScope', () => {
  it('routes active to listActive', async () => {
    const repo = lister();
    await expect(listForScope(ACTIVE_SCOPE, repo)).resolves.toEqual([note('active')]);
    expect(repo.listByTag).not.toHaveBeenCalled();
  });

  it('routes trashed to listTrashed', async () => {
    const repo = lister();
    await expect(listForScope(TRASHED_SCOPE, repo)).resolves.toEqual([note('trashed')]);
  });

  it('routes a tag to listByTag with the tag', async () => {
    const repo = lister();
    await expect(listForScope(tagScope('work/urgent'), repo)).resolves.toEqual([note('tagged')]);
    expect(repo.listByTag).toHaveBeenCalledWith('work/urgent');
  });
});
