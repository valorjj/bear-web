import { describe, expect, it } from 'vitest';

import { parseTags } from '../tags';
import { findLinkRanges, normalizeTitle, parseLinks } from './parseLinks';

describe('normalizeTitle', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeTitle('  Deploy   Checklist ')).toBe('deploy checklist');
    expect(normalizeTitle('Deploy\tChecklist')).toBe('deploy checklist');
  });
});

describe('parseLinks', () => {
  it('finds a link and returns its normalized title', () => {
    expect(parseLinks('See [[Deploy Checklist]] first.')).toEqual(['deploy checklist']);
  });

  it('finds several, de-duplicated, in first-appearance order', () => {
    expect(parseLinks('[[b]] then [[a]] then [[B]]')).toEqual(['b', 'a']);
  });

  it('ignores a link inside a fenced code block', () => {
    // The whole reason the masker is shared: this must agree with how
    // `parseTags` decides what is code.
    expect(parseLinks('text\n\n```\n[[not a link]]\n```\n\n[[real]]')).toEqual(['real']);
  });

  it('ignores a link inside inline code', () => {
    expect(parseLinks('`[[not a link]]` but [[real]]')).toEqual(['real']);
  });

  it('is not fooled by a fence closer carrying an info string', () => {
    // `parseTags` has a ruling for exactly this: a closer with an info string
    // inverted fence state and invented tags from inside code blocks.
    expect(parseLinks('```js\n[[hidden]]\n```js\n[[also hidden]]\n```')).toEqual([]);
  });

  it('ignores an unclosed `[[`', () => {
    expect(parseLinks('an [[unclosed link')).toEqual([]);
  });

  it('rejects an empty or whitespace-only target', () => {
    expect(parseLinks('[[]] and [[   ]]')).toEqual([]);
  });

  it('does not treat a single-bracket Markdown link as a note link', () => {
    expect(parseLinks('[text](https://example.com)')).toEqual([]);
  });

  it('stops at the first `]]`, so a title cannot swallow the rest of the line', () => {
    expect(parseLinks('[[one]] and [[two]]')).toEqual(['one', 'two']);
  });

  it('agrees with parseTags about what counts as code', () => {
    // The one test a COPIED masker would fail. One fixture, both parsers: a
    // fence, an inline span, and a live token of each kind after them.
    const fixture = '```\n#nope [[nope]]\n```\n\n`#no [[no]]`\n\n#yes [[yes]]';

    expect(parseTags(fixture)).toEqual(['yes']);
    expect(parseLinks(fixture)).toEqual(['yes']);
  });
});

describe('findLinkRanges', () => {
  it('reports offsets that slice the original text back out', () => {
    const text = 'See [[Deploy Checklist]] first.';
    const [range] = findLinkRanges(text);

    // A range whose offsets are merely "present" would pass a laxer test;
    // slicing proves they address the real characters.
    expect(text.slice(range!.start, range!.end)).toBe('[[Deploy Checklist]]');
    expect(range!.raw).toBe('Deploy Checklist');
    expect(range!.title).toBe('deploy checklist');
  });

  it('reports offsets into the ORIGINAL text, not the masked copy', () => {
    // Masking replaces code with the mask character one-for-one, so the
    // offsets it reports are valid in both copies. If a future edit made the
    // mask a different length, this test would fail.
    const text = '`code` then [[target]]';
    const [range] = findLinkRanges(text);

    expect(text.slice(range!.start, range!.end)).toBe('[[target]]');
  });
});
