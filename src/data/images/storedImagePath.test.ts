import { describe, expect, it } from 'vitest';

import {
  formatImageAlt,
  MAX_DISPLAY_WIDTH,
  parseImageAlt,
  storedImageId,
  storedImageIds,
  storedImagePath,
} from './storedImagePath';

describe('storedImagePath', () => {
  it('round-trips an id', () => {
    expect(storedImageId(storedImagePath('abc123'))).toBe('abc123');
  });

  it('is a relative path, not a scheme', () => {
    // Load-bearing and irreversible: a relative path is device-independent for
    // sync AND makes an exported folder a portable Markdown bundle.
    expect(storedImagePath('abc123')).toBe('files/abc123.webp');
  });

  it.each([
    ['an absolute URL that merely contains the shape', 'https://x.example/files/abc.webp'],
    ['a traversal attempt', 'files/../../etc/passwd.webp'],
    ['a different extension', 'files/abc.png'],
    ['a nested path', 'files/sub/abc.webp'],
    ['an empty id', 'files/.webp'],
    ['a plain remote URL', 'https://example.com/a.png'],
    ['a bare filename', 'abc.webp'],
  ])('does not match %s', (_what, path) => {
    expect(storedImageId(path)).toBeNull();
  });

  it('collects every referenced id from a note', () => {
    const markdown = [
      'Trip',
      `![beach](${storedImagePath('one')})`,
      'words',
      `![](${storedImagePath('two')})`,
      '![remote](https://example.com/x.png)',
    ].join('\n');

    // The remote URL is absent: it is not a stored file and the sweep must
    // never treat it as one.
    expect(storedImageIds(markdown)).toEqual(['one', 'two']);
  });

  it('collects each id once, however many times it appears', () => {
    const markdown = `![](${storedImagePath('one')}) and again ![](${storedImagePath('one')})`;

    expect(storedImageIds(markdown)).toEqual(['one']);
  });

  it('finds nothing in a note with no images', () => {
    expect(storedImageIds('Groceries\nmilk, bread')).toEqual([]);
  });
});

describe('parseImageAlt', () => {
  it('splits a numeric suffix into a width', () => {
    expect(parseImageAlt('beach|640')).toEqual({ alt: 'beach', width: 640 });
  });

  it('accepts a width with no alt', () => {
    expect(parseImageAlt('|640')).toEqual({ alt: '', width: 640 });
  });

  it('leaves a NON-numeric suffix as part of the alt text', () => {
    // Not a malformed width: `a|b` is what every other Markdown reader shows,
    // and guessing otherwise silently swallows a character the user typed.
    expect(parseImageAlt('a|b')).toEqual({ alt: 'a|b', width: null });
  });

  it('takes the LAST pipe, so an alt containing one still works', () => {
    expect(parseImageAlt('a|b|640')).toEqual({ alt: 'a|b', width: 640 });
  });

  it('has no width when there is no pipe', () => {
    expect(parseImageAlt('beach')).toEqual({ alt: 'beach', width: null });
  });

  it.each([
    ['zero', '|0'],
    ['a negative', '|-5'],
    ['a decimal', '|64.5'],
    ['a unit', '|640px'],
  ])('does not read %s as a width', (_what, raw) => {
    expect(parseImageAlt(raw).width).toBeNull();
  });

  it('clamps a width above the maximum', () => {
    // A note edited by hand can carry anything, and a 999999px image is a
    // broken layout whose cause the user cannot see.
    expect(parseImageAlt(`|${MAX_DISPLAY_WIDTH + 500}`).width).toBe(MAX_DISPLAY_WIDTH);
  });
});

describe('formatImageAlt', () => {
  it('omits the pipe entirely when there is no width', () => {
    // Load-bearing: an image nobody resized must round-trip byte-identically
    // to what K1 wrote.
    expect(formatImageAlt('beach', null)).toBe('beach');
  });

  it('writes the width after a pipe', () => {
    expect(formatImageAlt('beach', 640)).toBe('beach|640');
  });

  it.each(['beach', 'beach|640', '|640', 'a|b', ''])('round-trips %o', (raw) => {
    const parsed = parseImageAlt(raw);

    expect(formatImageAlt(parsed.alt, parsed.width)).toBe(raw);
  });
});
