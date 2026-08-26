import { describe, expect, it } from 'vitest';

import { storedImagePath } from '@/data';

import { firstStoredImageId } from './thumbnail';

describe('firstStoredImageId', () => {
  it('is null for a note with no image', () => {
    expect(firstStoredImageId('Groceries\nmilk, bread')).toBeNull();
  });

  it('finds the first stored image', () => {
    const text = `Trip\n![beach](${storedImagePath('one')})\n![](${storedImagePath('two')})`;

    expect(firstStoredImageId(text)).toBe('one');
  });

  it('IGNORES a remote image URL, which is a privacy rule and not an omission', () => {
    // This function returned exactly this URL until K1, so the row rendered
    // `<img src="https://…">` and opening the app made a third-party request
    // for every note naming one. An e2e test caught it by routing the host and
    // watching the request happen while the editor correctly made none.
    expect(firstStoredImageId('Trip\n![beach](https://example.com/a.png)')).toBeNull();
  });

  it('prefers a stored image over a remote one that appears first', () => {
    const text = `Trip\n![](https://example.com/a.png)\n![](${storedImagePath('mine')})`;

    expect(firstStoredImageId(text)).toBe('mine');
  });
});
