import { describe, expect, it } from 'vitest';

import { splitLinkTarget } from './splitLinkTarget';

const known = (...titles: string[]) => {
  const set = new Set(titles);
  return (title: string) => set.has(title);
};

describe('splitLinkTarget', () => {
  it('returns the whole string as a title when it names a note', () => {
    expect(splitLinkTarget('Deploy Checklist', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: null,
      slash: -1,
    });
  });

  // The branch that must stay FIRST: a note genuinely titled `A/B testing`
  // is a note, never note `A` plus heading `B testing`.
  it('prefers the whole string over a split when both would resolve', () => {
    expect(splitLinkTarget('A/B testing', known('a/b testing', 'a'))).toEqual({
      title: 'a/b testing',
      heading: null,
      slash: -1,
    });
  });

  it('splits at the slash when the prefix names a note', () => {
    expect(splitLinkTarget('Deploy Checklist/Rollback', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: 'rollback',
      slash: 16,
    });
  });

  // The LONGEST title prefix wins, so a heading may itself contain a slash.
  // The intuitive reading is the opposite, which is why this is pinned.
  it('takes the longest known prefix, leaving slashes in the heading', () => {
    expect(splitLinkTarget('A/B testing/Setup/Notes', known('a/b testing', 'a'))).toEqual({
      title: 'a/b testing',
      heading: 'setup/notes',
      slash: 11,
    });
  });

  it('reports a raw offset, not an offset into the normalized title', () => {
    // Two spaces and mixed case: `normalizeTitle` would shorten and lowercase
    // this, so an index taken from its output would point at the wrong
    // character in the text the pill actually decorates.
    const raw = 'Deploy  Checklist/Rollback';
    const result = splitLinkTarget(raw, known('deploy checklist'));

    expect(result.slash).toBe(17);
    expect(raw[result.slash]).toBe('/');
  });

  it('falls back to the whole string when nothing resolves', () => {
    expect(splitLinkTarget('Nowhere/At all', known('something else'))).toEqual({
      title: 'nowhere/at all',
      heading: null,
      slash: -1,
    });
  });

  it('ignores a candidate with an empty side', () => {
    expect(splitLinkTarget('Deploy Checklist/', known('deploy checklist'))).toEqual({
      title: 'deploy checklist/',
      heading: null,
      slash: -1,
    });
    // A leading slash is also the input that makes the obvious
    // `lastIndexOf('/', i - 1)` loop spin forever — see the implementation.
    expect(splitLinkTarget('/Rollback', known(''))).toEqual({
      title: '/rollback',
      heading: null,
      slash: -1,
    });
  });

  it('normalizes whitespace around the slash', () => {
    expect(splitLinkTarget('Deploy Checklist / Rollback', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: 'rollback',
      slash: 17,
    });
  });

  describe('allowEmptyHeading', () => {
    // The `[[` popover's case: a reader who has typed the slash has asked for
    // that note's headings and has not filtered them yet.
    it('reports an empty heading for a trailing slash', () => {
      expect(
        splitLinkTarget('Deploy Checklist/', known('deploy checklist'), {
          allowEmptyHeading: true,
        }),
      ).toEqual({ title: 'deploy checklist', heading: '', slash: 16 });
    });

    it('still refuses an empty TITLE side', () => {
      expect(splitLinkTarget('/Rollback', known(''), { allowEmptyHeading: true })).toEqual({
        title: '/rollback',
        heading: null,
        slash: -1,
      });
    });

    it('still prefers the whole string when it names a note', () => {
      expect(
        splitLinkTarget('A/B testing', known('a/b testing', 'a'), { allowEmptyHeading: true }),
      ).toEqual({ title: 'a/b testing', heading: null, slash: -1 });
    });
  });
});
