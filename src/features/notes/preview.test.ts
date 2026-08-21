import { describe, expect, it } from 'vitest';

import { DEFAULT_PREVIEW_SIZE, isPreviewSize, PREVIEW_SIZES, snippetLines } from './preview';

describe('preview size', () => {
  it('defaults to large, which is the row the app shipped with', () => {
    expect(DEFAULT_PREVIEW_SIZE).toBe('large');
  });

  it('lists the three sizes smallest first, which is the menu order', () => {
    expect(PREVIEW_SIZES).toEqual(['small', 'medium', 'large']);
  });

  it('maps each size to a snippet line count', () => {
    expect(snippetLines('small')).toBe(0);
    expect(snippetLines('medium')).toBe(1);
    expect(snippetLines('large')).toBe(2);
  });

  it('rejects a value that is not a size', () => {
    expect(isPreviewSize('enormous')).toBe(false);
    expect(isPreviewSize(2)).toBe(false);
    expect(isPreviewSize(null)).toBe(false);
  });

  it('accepts every listed size', () => {
    for (const size of PREVIEW_SIZES) expect(isPreviewSize(size)).toBe(true);
  });
});
