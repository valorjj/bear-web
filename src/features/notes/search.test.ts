import { describe, expect, it } from 'vitest';

import type { Note } from '@/data';

import { filterByQuery, findMatchRanges, hasQuery, normalizeForSearch } from './search';

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    text: '',
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe('hasQuery', () => {
  it('is false for an empty query', () => {
    expect(hasQuery('')).toBe(false);
  });

  it('is false for a whitespace-only query', () => {
    expect(hasQuery('   \t ')).toBe(false);
  });

  it('is true once there is a non-space character', () => {
    expect(hasQuery('  a ')).toBe(true);
  });
});

describe('normalizeForSearch', () => {
  it('folds case', () => {
    expect(normalizeForSearch('MiLk')).toBe('milk');
  });

  // Decomposed Hangul reaches this app through importDatabase; a note written
  // on macOS can be NFD while a query typed in the browser is NFC. Without
  // normalization the note is unfindable by its own contents.
  it('folds decomposed Hangul onto its composed form', () => {
    const composed = '가'; // 가
    const decomposed = '가'.normalize('NFD'); // ᄀ + ᅡ
    expect(decomposed).not.toBe(composed);
    expect(normalizeForSearch(decomposed)).toBe(normalizeForSearch(composed));
  });
});

describe('findMatchRanges', () => {
  it('finds every occurrence, case-insensitively', () => {
    expect(findMatchRanges('Milk and milk', 'milk')).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('finds adjacent occurrences without overlapping them', () => {
    expect(findMatchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  // indexOf, not RegExp: a metacharacter must match itself.
  it('treats regex metacharacters literally', () => {
    expect(findMatchRanges('a.c and abc', '.')).toEqual([{ start: 1, end: 2 }]);
    expect(findMatchRanges('x(y)', '(y)')).toEqual([{ start: 1, end: 4 }]);
  });

  it('returns nothing for a query that is empty after trimming', () => {
    expect(findMatchRanges('anything', '   ')).toEqual([]);
  });

  it('indexes into the NFC-normalized text, so Hangul offsets stay aligned', () => {
    const decomposed = `${'가'.normalize('NFD')} milk`; // NFD '가 milk', 7 code units
    const ranges = findMatchRanges(decomposed, 'milk');
    // 'milk' begins at index 2 of the COMPOSED string '가 milk', not index 3.
    expect(ranges).toEqual([{ start: 2, end: 6 }]);
    expect(decomposed.normalize('NFC').slice(2, 6)).toBe('milk');
  });

  // 'İ'.toLowerCase() is two code units, which would shift every later index.
  // Returning no ranges loses highlighting; returning shifted ranges would
  // mark the wrong characters.
  it('returns no ranges rather than misaligned ones when folding changes length', () => {
    expect('İ'.toLowerCase()).toHaveLength(2);
    expect(findMatchRanges('İstanbul', 'stan')).toEqual([]);
  });
});

describe('filterByQuery', () => {
  const milk = note({ id: 'a', title: 'Groceries', text: 'Groceries\nmilk and bread' });
  const work = note({ id: 'b', title: 'Sprint', text: 'Sprint\n#work/urgent' });

  it('passes undefined through, so "still loading" stays distinguishable from "no matches"', () => {
    expect(filterByQuery(undefined, 'milk')).toBeUndefined();
  });

  it('returns every note when the query is empty', () => {
    expect(filterByQuery([milk, work], '')).toEqual([milk, work]);
  });

  it('returns every note when the query is only whitespace', () => {
    expect(filterByQuery([milk, work], '  ')).toEqual([milk, work]);
  });

  it('matches body text', () => {
    expect(filterByQuery([milk, work], 'bread')).toEqual([milk]);
  });

  // Tags are inline hashtags in the note's own text, so they need no separate
  // index or syntax to be searchable.
  it('matches an inline hashtag', () => {
    expect(filterByQuery([milk, work], 'urgent')).toEqual([work]);
  });

  it('matches a decomposed note from a composed query', () => {
    const hangul = note({ id: 'c', text: `${'가'.normalize('NFD')}기` }); // NFD 가기
    expect(filterByQuery([hangul], '가')).toEqual([hangul]);
  });

  it('preserves the order it was given', () => {
    expect(filterByQuery([work, milk], 'r')).toEqual([work, milk]);
  });
});
