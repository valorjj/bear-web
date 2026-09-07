import { describe, expect, it } from 'vitest';

import { parseTags } from './parseTags';
import { canWriteTag, rewriteTag } from './rewriteTag';

describe('rewriteTag — renaming', () => {
  it('renames the exact tag', () => {
    expect(rewriteTag('see #work today', 'work', 'job')).toBe('see #job today');
  });

  it('renames descendants, keeping their tail', () => {
    expect(rewriteTag('a #a/b/c b', 'a/b', 'x')).toBe('a #x/c b');
  });

  it('leaves a tag that merely shares a prefix', () => {
    // `a/bc` is NOT a descendant of `a/b`. Matching on the normalized NAME,
    // not on raw text, is what makes this free of a special case.
    expect(rewriteTag('see #a/bc', 'a/b', 'x')).toBe('see #a/bc');
  });

  it('replaces a multi-word tag whole, closing hash included', () => {
    expect(rewriteTag('see #my project# ok', 'my project', 'plan')).toBe('see #plan ok');
  });

  it('writes the multi-word form when the new name needs one', () => {
    expect(rewriteTag('see #work', 'work', 'my plan')).toBe('see #my plan#');
  });

  it('keeps a trailing full stop out of the rewrite', () => {
    // `range.end` excludes punctuation `normalizeTag` trimmed, so the
    // sentence keeps its own period.
    expect(rewriteTag('done #work. next', 'work', 'job')).toBe('done #job. next');
  });

  it('leaves tags inside fenced code alone', () => {
    const source = 'text #work\n\n```\n#work in code\n```\n';
    expect(rewriteTag(source, 'work', 'job')).toBe('text #job\n\n```\n#work in code\n```\n');
  });

  it('leaves tags inside inline code alone', () => {
    expect(rewriteTag('a `#work` b #work', 'work', 'job')).toBe('a `#work` b #job');
  });

  it('leaves a url fragment and a link destination alone', () => {
    const source = 'see https://x/#work and [x](#work) and #work';
    expect(rewriteTag(source, 'work', 'job')).toBe('see https://x/#work and [x](#work) and #job');
  });

  it('rewrites every occurrence', () => {
    expect(rewriteTag('#work then #work', 'work', 'job')).toBe('#job then #job');
  });

  it('lands the invariant: `to` present, `from` absent', () => {
    const out = rewriteTag('x #a/b y #a/b/c z', 'a/b', 'q');
    expect(parseTags(out).sort()).toEqual(['q', 'q/c']);
    expect(parseTags(out)).not.toContain('a/b');
  });
});

describe('rewriteTag — deleting', () => {
  it('collapses a mid-line hole to one space', () => {
    expect(rewriteTag('see #a/b today', 'a/b', null)).toBe('see today');
  });

  it('trims a trailing space', () => {
    expect(rewriteTag('see #a/b', 'a/b', null)).toBe('see');
  });

  it('trims a leading space', () => {
    expect(rewriteTag('#a/b see', 'a/b', null)).toBe('see');
  });

  it('removes a tag-only line, newline included', () => {
    expect(rewriteTag('one\n#a/b\ntwo\n', 'a/b', null)).toBe('one\ntwo\n');
  });

  it('keeps a line that still has another tag on it', () => {
    expect(rewriteTag('#a/b #other', 'a/b', null)).toBe('#other');
  });

  it('deletes descendants too', () => {
    const out = rewriteTag('x #a/b y #a/b/c z', 'a/b', null);
    expect(parseTags(out)).toEqual([]);
    expect(out).toBe('x y z');
  });
});

describe('canWriteTag', () => {
  it.each([
    ['work', true],
    ['a/b/c', true],
    ['my plan', true],
    ['has#hash', false],
  ])('%s -> %s', (tag, expected) => {
    expect(canWriteTag(tag)).toBe(expected);
  });
});

describe('rewriteTag — round trip', () => {
  it('restores the original tag set when renamed back', () => {
    const source = 'x #a/b y\n\n#a/b/c and #other\n';
    const there = rewriteTag(source, 'a/b', 'q');
    const back = rewriteTag(there, 'q', 'a/b');
    // Whitespace collapsing is not byte-reversible, so the invariant is on
    // the TAG SET, deliberately, not on the string.
    expect(parseTags(back).sort()).toEqual(parseTags(source).sort());
  });
});
