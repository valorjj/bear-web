import { describe, expect, it } from 'vitest';

import { storedImageId, storedImageIds, storedImagePath } from './storedImagePath';

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
