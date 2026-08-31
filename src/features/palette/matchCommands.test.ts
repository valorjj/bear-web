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

  it('reports whether every matched character landed on a word boundary', () => {
    // "eap" -> E(xport) a(s) P(DF): three boundaries, nothing mid-word.
    expect(matchOne('Export as PDF', 'eap')?.allBoundary).toBe(true);
    // "xp" lands mid-word in "Export".
    expect(matchOne('Export as PDF', 'xp')?.allBoundary).toBe(false);
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

  it('prefers a tighter span when boundary quality ties', () => {
    const items = [item('loose', 'New note from template'), item('tight', 'New note')];

    expect(matchAll(items, 'nn')[0]!.id).toBe('tight');
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
