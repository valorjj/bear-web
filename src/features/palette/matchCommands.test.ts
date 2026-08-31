import { describe, expect, it } from 'vitest';

import { matchAll, matchOne } from './matchCommands';

const item = (id: string, label: string) => ({ id, label });

describe('matchOne', () => {
  it('matches a subsequence, not just a substring', () => {
    // "epdf" -> Export as PDF. This is the whole reason for a custom matcher.
    expect(matchOne('Export as PDF', 'epdf')).not.toBeNull();
  });

  it('rejects characters that are out of order', () => {
    expect(matchOne('Export as PDF', 'fdpe')).toBeNull();
  });

  it('rejects a character the label does not contain', () => {
    expect(matchOne('Export as PDF', 'epdfz')).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(matchOne('Anything', '')).not.toBeNull();
  });

  it('folds case and normalizes', () => {
    expect(matchOne('Export as PDF', 'EXPORT')).not.toBeNull();
  });
});

describe('matchAll ranking', () => {
  it('puts a prefix match first', () => {
    const items = [item('trash-empty', 'Empty trash'), item('trash-move', 'Move to trash')];

    // Neither starts with "trash"; both match. Now add one that does.
    const withPrefix = [...items, item('trash-go', 'Trash')];
    expect(matchAll(withPrefix, 'trash')[0]!.id).toBe('trash-go');
  });

  it('prefers an all-boundary match over a mid-word one', () => {
    const items = [item('mid', 'Sync export'), item('bound', 'Export as PDF')];

    // "exp" is a prefix of "Export" in `bound` (boundary at index 0) but lands
    // mid-label in `mid`.
    expect(matchAll(items, 'exp')[0]!.id).toBe('bound');
  });

  it('prefers higher boundary count when other rules tie', () => {
    const items = [item('a', 'xb cxx'), item('b', 'xbcxxx')];

    // query 'bc': in 'a', b at 1 (not boundary), c at 3 (boundary) → boundaryCount 1, span 3
    // in 'b', b at 1 (not boundary), c at 2 (not boundary) → boundaryCount 0, span 2
    // Both startsWith false, length 6. Rule 3 (boundaryCount) decides.
    expect(matchAll(items, 'bc')[0]!.id).toBe('a');
  });

  it('prefers a tighter span when other rules tie', () => {
    const items = [item('b', 'abdxxx'), item('a', 'abxdxx')];

    // query 'bd': in 'b', d at 2 → span 2; in 'a', d at 3 → span 3
    // Both startsWith false, boundaryCount 0, length 6. Span decides, so 'b' first.
    expect(matchAll(items, 'bd')[0]!.id).toBe('b');
  });

  it('prefers the shorter label when everything else ties', () => {
    const items = [item('long', 'Pin note to the top'), item('short', 'Pin note')];

    expect(matchAll(items, 'pin')[0]!.id).toBe('short');
  });

  it('breaks remaining ties by id, so the order is stable', () => {
    // Identical labels: only the id can decide, and it must decide the same
    // way every run — an unstable order is an unstable UI and untestable.
    const items = [item('b', 'Same label'), item('a', 'Same label')];

    expect(matchAll(items, 'same').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('returns every item, in id order, for an empty query', () => {
    const items = [item('b', 'Beta'), item('a', 'Alpha')];

    expect(matchAll(items, '   ').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('drops non-matching items entirely', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta')];

    expect(matchAll(items, 'alp').map((i) => i.id)).toEqual(['a']);
  });
});
