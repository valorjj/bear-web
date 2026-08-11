import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';

import {
  ACTIVE_SCOPE,
  acceptsNewNote,
  allowsTrash,
  isTrash,
  listForScope,
  scopeKey,
  seedTagFor,
  smartScope,
  SMART_LIST_IDS,
  type SmartListId,
  tagScope,
  TRASHED_SCOPE,
} from './scope';

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
    expect(scopeKey(ACTIVE_SCOPE)).toBe('smart:all');
    expect(scopeKey(TRASHED_SCOPE)).toBe('smart:trash');
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

describe('capabilities', () => {
  // Exhaustive over SmartListId. A new smart list added without a ruling on
  // its capabilities fails here rather than silently inheriting a default —
  // this is the assertion that would have caught the M5 defect where a new
  // union arm rendered no delete affordance at all.
  const EXPECTED: Record<SmartListId, { trash: boolean; allowsTrash: boolean; accepts: boolean }> =
    {
      all: { trash: false, allowsTrash: true, accepts: true },
      untagged: { trash: false, allowsTrash: true, accepts: true },
      todo: { trash: false, allowsTrash: true, accepts: false },
      today: { trash: false, allowsTrash: true, accepts: true },
      pinned: { trash: false, allowsTrash: true, accepts: false },
      locked: { trash: false, allowsTrash: false, accepts: false },
      trash: { trash: true, allowsTrash: false, accepts: false },
    };

  it('covers every smart list', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SMART_LIST_IDS].sort());
  });

  for (const list of SMART_LIST_IDS) {
    it(`rules on ${list}`, () => {
      const scope = smartScope(list);
      expect(isTrash(scope)).toBe(EXPECTED[list].trash);
      expect(allowsTrash(scope)).toBe(EXPECTED[list].allowsTrash);
      expect(acceptsNewNote(scope)).toBe(EXPECTED[list].accepts);
      expect(seedTagFor(scope)).toBeNull();
    });
  }

  it('treats a tag scope as ordinary and seedable', () => {
    const scope = tagScope('work');
    expect(isTrash(scope)).toBe(false);
    expect(allowsTrash(scope)).toBe(true);
    expect(acceptsNewNote(scope)).toBe(true);
    expect(seedTagFor(scope)).toBe('work');
  });

  it('keeps the builtin constants pointing at the right lists', () => {
    expect(scopeKey(ACTIVE_SCOPE)).toBe('smart:all');
    expect(scopeKey(TRASHED_SCOPE)).toBe('smart:trash');
  });

  it('does not let a tag collide with a builtin name', () => {
    expect(scopeKey(tagScope('all'))).not.toBe(scopeKey(ACTIVE_SCOPE));
  });
});
