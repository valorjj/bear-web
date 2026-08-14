import { describe, expect, it } from 'vitest';

import { findTagRanges } from './parseTags';

describe('findTagRanges', () => {
  it('locates a simple tag', () => {
    expect(findTagRanges('a #work b')).toEqual([{ tag: 'work', start: 2, end: 7 }]);
  });

  it('locates a tag at the very start', () => {
    expect(findTagRanges('#work b')).toEqual([{ tag: 'work', start: 0, end: 5 }]);
  });

  it('locates a multi-word tag including its closing hash', () => {
    const [range] = findTagRanges('see #big idea# now');
    expect(range).toEqual({ tag: 'big idea', start: 4, end: 14 });
    expect('see #big idea# now'.slice(range!.start, range!.end)).toBe('#big idea#');
  });

  it('locates every tag on a line, in order', () => {
    expect(findTagRanges('#a and #b').map((r) => r.tag)).toEqual(['a', 'b']);
    expect(findTagRanges('#a and #b').map((r) => r.start)).toEqual([0, 7]);
  });

  // Unlike parseTags, ranges are not deduped — two occurrences of one tag are
  // two pills.
  it('returns one range per occurrence, not per distinct tag', () => {
    expect(findTagRanges('#work then #work')).toHaveLength(2);
  });

  it('excludes a trailing period from the range, matching the trimmed name', () => {
    const [range] = findTagRanges('#done. next');
    expect(range?.tag).toBe('done');
    // The scanner consumed '#done.' but the tag is 'done'; the range must
    // cover what the pill should paint, which is the tag text only.
    expect('#done. next'.slice(range!.start, range!.end)).toBe('#done');
  });

  // maskCode replaces characters one-for-one, so an index into the masked copy
  // is an index into the original. If that ever stops being true, every range
  // shifts silently.
  it('returns indices into the original string, not the masked copy', () => {
    const input = 'x`code` #work';
    const [range] = findTagRanges(input);
    expect(input.slice(range!.start, range!.end)).toBe('#work');
  });

  it('finds nothing inside a code span or a fenced block', () => {
    expect(findTagRanges('`#work`')).toEqual([]);
    expect(findTagRanges('```\n#work\n```')).toEqual([]);
  });
});
