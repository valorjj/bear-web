import { describe, expect, it } from 'vitest';

import { firstImageUrl } from './thumbnail';

describe('firstImageUrl', () => {
  it('is null for a note with no image', () => {
    expect(firstImageUrl('Groceries\nmilk, bread')).toBeNull();
  });

  it('is null for the empty note', () => {
    expect(firstImageUrl('')).toBeNull();
  });

  it('finds an image on its own line', () => {
    expect(firstImageUrl('Trip\n![beach](https://example.com/a.png)')).toBe(
      'https://example.com/a.png',
    );
  });

  it('finds an image sitting inside a line of prose', () => {
    expect(firstImageUrl('Trip\nwe went ![beach](https://example.com/a.png) last week')).toBe(
      'https://example.com/a.png',
    );
  });

  it('returns the FIRST image when a note holds several', () => {
    expect(
      firstImageUrl('Trip\n![a](https://example.com/a.png)\n![b](https://example.com/b.png)'),
    ).toBe('https://example.com/a.png');
  });

  it('drops a title from the destination', () => {
    expect(firstImageUrl('![a](https://example.com/a.png "Beach at dawn")')).toBe(
      'https://example.com/a.png',
    );
  });

  it('accepts an angle-bracketed destination', () => {
    expect(firstImageUrl('![a](<https://example.com/a b.png>)')).toBe(
      'https://example.com/a b.png',
    );
  });

  it('ignores a plain link, which is the same syntax without the bang', () => {
    expect(firstImageUrl('Trip\n[beach](https://example.com/a.png)')).toBeNull();
  });

  it('ignores an image inside a fenced code block', () => {
    // The whole point of a fence is that its contents are not Markdown. A
    // note documenting the image syntax must not sprout a thumbnail of
    // whatever URL the example happens to name.
    const text = ['Syntax', '```md', '![a](https://example.com/a.png)', '```'].join('\n');
    expect(firstImageUrl(text)).toBeNull();
  });

  it('finds an image AFTER a closed fence', () => {
    const text = [
      'Syntax',
      '```md',
      '![a](https://example.com/in-fence.png)',
      '```',
      '![b](https://example.com/after.png)',
    ].join('\n');
    expect(firstImageUrl(text)).toBe('https://example.com/after.png');
  });

  it('ignores an image inside a tilde fence', () => {
    const text = ['~~~', '![a](https://example.com/a.png)', '~~~'].join('\n');
    expect(firstImageUrl(text)).toBeNull();
  });

  it.each([
    ['http, which a page served over https cannot load', 'http://example.com/a.png'],
    ['a file URL, which the browser refuses from a page', 'file:///Users/me/a.png'],
    ['javascript, which is an attack and not an image', 'javascript:alert(1)'],
    ['a bare relative path, which resolves against the app and never an image', '/a.png'],
  ])('rejects %s', (_why, url) => {
    expect(firstImageUrl(`![a](${url})`)).toBeNull();
  });

  it('accepts a data URL for an image', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(firstImageUrl(`![a](${url})`)).toBe(url);
  });

  it('rejects a data URL that is not an image', () => {
    expect(firstImageUrl('![a](data:text/html,<script>alert(1)</script>)')).toBeNull();
  });

  it('skips a rejected image and keeps looking', () => {
    expect(firstImageUrl('![a](http://example.com/a.png)\n![b](https://example.com/b.png)')).toBe(
      'https://example.com/b.png',
    );
  });
});
