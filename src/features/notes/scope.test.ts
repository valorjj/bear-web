import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';

import {
  ACTIVE_SCOPE,
  acceptsNewNote,
  DEFAULT_SCOPE_QUERY,
  allowsTrash,
  isTrash,
  listForScope,
  type NoteScope,
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
    allTagRows: vi.fn(async () => []),
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
    await expect(listForScope(ACTIVE_SCOPE, DEFAULT_SCOPE_QUERY, repo)).resolves.toEqual([
      note('active'),
    ]);
    expect(repo.listByTag).not.toHaveBeenCalled();
  });

  it('routes trashed to listTrashed', async () => {
    const repo = lister();
    await expect(listForScope(TRASHED_SCOPE, DEFAULT_SCOPE_QUERY, repo)).resolves.toEqual([
      note('trashed'),
    ]);
  });

  it('routes a tag to listByTag with the tag', async () => {
    const repo = lister();
    await expect(listForScope(tagScope('work/urgent'), DEFAULT_SCOPE_QUERY, repo)).resolves.toEqual(
      [note('tagged')],
    );
    expect(repo.listByTag).toHaveBeenCalledWith('work/urgent', {
      order: DEFAULT_SCOPE_QUERY.order,
      includeDescendants: true,
    });
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

describe('listForScope over smart lists', () => {
  const base = {
    id: '',
    title: '',
    text: '',
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
  const NOW = new Date(2026, 7, 11, 12, 0, 0).getTime();
  const YESTERDAY = new Date(2026, 7, 10, 12, 0, 0).getTime();

  const active = [
    { ...base, id: 'plain', updatedAt: YESTERDAY },
    { ...base, id: 'tagged', updatedAt: YESTERDAY, text: 'see #work' },
    { ...base, id: 'todo', updatedAt: YESTERDAY, text: '- [ ] milk' },
    { ...base, id: 'done', updatedAt: YESTERDAY, text: '- [x] milk' },
    { ...base, id: 'fresh', updatedAt: NOW },
    { ...base, id: 'pin', updatedAt: YESTERDAY, pinned: true },
  ];

  const repo = {
    listActive: async () => active,
    listTrashed: async () => [{ ...base, id: 'gone', trashedAt: 1 }],
    listByTag: async (tag: string) => (tag === 'work' ? [active[1]!] : []),
    allTagRows: async () => [{ noteId: 'tagged', tag: 'work' }],
  };

  const ids = async (scope: NoteScope) =>
    (await listForScope(scope, DEFAULT_SCOPE_QUERY, repo, () => NOW)).map((n) => n.id);

  it('returns every active note for all', async () => {
    expect(await ids(ACTIVE_SCOPE)).toEqual(active.map((n) => n.id));
  });

  it('returns only trashed notes for trash', async () => {
    expect(await ids(TRASHED_SCOPE)).toEqual(['gone']);
  });

  it('excludes notes carrying a tag from untagged', async () => {
    expect(await ids(smartScope('untagged'))).not.toContain('tagged');
  });

  it('keeps untagged notes in untagged', async () => {
    expect(await ids(smartScope('untagged'))).toContain('plain');
  });

  it('returns only notes with an unchecked task for todo', async () => {
    expect(await ids(smartScope('todo'))).toEqual(['todo']);
  });

  it('returns only notes updated today for today', async () => {
    expect(await ids(smartScope('today'))).toEqual(['fresh']);
  });

  it('returns only pinned notes for pinned', async () => {
    expect(await ids(smartScope('pinned'))).toEqual(['pin']);
  });

  it('returns nothing for locked', async () => {
    expect(await ids(smartScope('locked'))).toEqual([]);
  });

  it('delegates a tag scope to the repository', async () => {
    expect(await ids(tagScope('work'))).toEqual(['tagged']);
  });

  it('does not read the tag index for lists that do not need it', async () => {
    // allTagRows is a full table scan. Only `untagged` needs it, and paying
    // for it on every scope switch would be a needless second scan.
    let calls = 0;
    const counting = {
      ...repo,
      allTagRows: async () => {
        calls += 1;
        return repo.allTagRows();
      },
    };
    await listForScope(smartScope('todo'), DEFAULT_SCOPE_QUERY, counting, () => NOW);
    expect(calls).toBe(0);
    await listForScope(smartScope('untagged'), DEFAULT_SCOPE_QUERY, counting, () => NOW);
    expect(calls).toBe(1);
  });
});

describe('listForScope ordering', () => {
  function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      listActive: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listByTag: vi.fn().mockResolvedValue([]),
      allTagRows: vi.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('hands the order to listActive rather than re-sorting the result', async () => {
    const repository = fakeRepository();
    const order = { field: 'title', newestFirst: false } as const;

    await listForScope(smartScope('all'), { order, includeDescendants: true }, repository);

    expect(repository.listActive).toHaveBeenCalledWith(order);
  });

  it('hands both the order and the sub-tag flag to listByTag', async () => {
    const repository = fakeRepository();
    const order = { field: 'created', newestFirst: true } as const;

    await listForScope(tagScope('work'), { order, includeDescendants: false }, repository);

    expect(repository.listByTag).toHaveBeenCalledWith('work', {
      order,
      includeDescendants: false,
    });
  });

  it('calls listTrashed with no arguments, because Trash owns its order', async () => {
    const repository = fakeRepository();

    await listForScope(
      smartScope('trash'),
      { order: { field: 'title', newestFirst: false }, includeDescendants: true },
      repository,
    );

    expect(repository.listTrashed).toHaveBeenCalledWith();
  });

  it('preserves the repository order rather than re-sorting a smart list', async () => {
    // The repository returns C, A, B. A predicate-filtered smart list must hand
    // that order straight through — re-sorting here is what this module's
    // ruling forbids, and a comparator applied here would silently "fix" this
    // into A, B, C.
    const make = (id: string, n: number): Note => ({
      id,
      title: id.toUpperCase(),
      text: '',
      createdAt: n,
      updatedAt: n,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    const repository = fakeRepository({
      listActive: vi.fn().mockResolvedValue([make('c', 3), make('a', 1), make('b', 2)]),
    });

    const result = await listForScope(
      smartScope('all'),
      { order: { field: 'title', newestFirst: false }, includeDescendants: true },
      repository,
    );

    expect(result.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });
});
