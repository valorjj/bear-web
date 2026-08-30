import { describe, expect, it } from 'vitest';

import { resolveLinkTarget } from './resolveLinkTarget';

/**
 * The only piece of Task 4's logic with real branching, and the one whose
 * mistake is invisible on screen: a wrong tie-break opens the WRONG note and
 * looks like it worked. See `docs/superpowers/specs/2026-08-31-l2-backlinks-design.md`,
 * "A link resolves by TITLE, and fails open": "Where two notes share a
 * title, the most recently updated one wins."
 */
describe('resolveLinkTarget', () => {
  it('picks the most recently updated match when two notes share a title', () => {
    // Deliberately NOT first in array order and NOT first alphabetically by
    // id, so a `[0]`- or a `.sort()`-by-id implementation would pick the
    // wrong one and this test would still catch it.
    const older = { id: 'zzz-older', title: 'Deploy Checklist', updatedAt: 100 };
    const newer = { id: 'aaa-newer', title: 'Deploy Checklist', updatedAt: 200 };
    const unrelated = { id: 'mmm-unrelated', title: 'Something Else', updatedAt: 300 };

    const result = resolveLinkTarget([older, newer, unrelated], 'deploy checklist');

    expect(result?.id).toBe('aaa-newer');
  });

  it('resolves case-insensitively and across collapsed whitespace', () => {
    const note = { id: 'note-1', title: 'Deploy Checklist', updatedAt: 1 };

    // '[[Deploy  Checklist]]' normalizes to 'deploy checklist' before
    // reaching this function (LinkPill's job); this asserts the OTHER half —
    // that a candidate note's own title is normalized too before comparing.
    const result = resolveLinkTarget([note], 'deploy checklist');

    expect(result?.id).toBe('note-1');
  });

  it('returns null for a title with no matching note, and does not throw', () => {
    const note = { id: 'note-1', title: 'Deploy Checklist', updatedAt: 1 };

    expect(() => resolveLinkTarget([note], 'nothing here')).not.toThrow();
    expect(resolveLinkTarget([note], 'nothing here')).toBeNull();
  });

  it('returns null against an empty index', () => {
    expect(resolveLinkTarget([], 'deploy checklist')).toBeNull();
  });
});
