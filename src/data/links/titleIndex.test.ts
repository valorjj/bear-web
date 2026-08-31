import { describe, expect, it } from 'vitest';

import { buildTitleIndex } from './titleIndex';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string, updatedAt = NOW) => ({ id, title, updatedAt });

describe('buildTitleIndex', () => {
  it('keys each note by its normalized title', () => {
    const index = buildTitleIndex([note('a', '  Alpha Note  ')]);

    expect(index.get('alpha note')?.id).toBe('a');
  });

  it('keeps the most recently updated note when titles collide', () => {
    // Not first-match: first-match happens to be right whenever the winner is
    // also first in the array, which is exactly the case a shallow test misses.
    // The newer note is deliberately LAST here, then FIRST in the next case.
    const index = buildTitleIndex([
      note('old', 'Duplicate', NOW - 1000),
      note('new', 'Duplicate', NOW),
    ]);

    expect(index.get('duplicate')?.id).toBe('new');
  });

  it('keeps the most recently updated note when the winner comes first', () => {
    const index = buildTitleIndex([
      note('new', 'Duplicate', NOW),
      note('old', 'Duplicate', NOW - 1000),
    ]);

    expect(index.get('duplicate')?.id).toBe('new');
  });

  it('has no entry for a title nothing carries', () => {
    expect(buildTitleIndex([note('a', 'Alpha')]).get('beta')).toBeUndefined();
  });
});
