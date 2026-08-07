import { describe, expect, it } from 'vitest';

import {
  clampPaneWidth,
  DEFAULT_NOTE_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
} from './paneWidths';

describe('clampPaneWidth', () => {
  it('passes through a width inside the range', () => {
    expect(clampPaneWidth(300)).toBe(300);
  });

  it('clamps below the minimum and above the maximum', () => {
    expect(clampPaneWidth(10)).toBe(MIN_PANE_WIDTH);
    expect(clampPaneWidth(9999)).toBe(MAX_PANE_WIDTH);
  });

  it('rounds fractional widths', () => {
    expect(clampPaneWidth(240.6)).toBe(241);
  });

  it('falls back to the default for values that are not finite', () => {
    expect(clampPaneWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampPaneWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampPaneWidth(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('falls back to a caller-supplied default for values that are not finite', () => {
    expect(clampPaneWidth(Number.NaN, DEFAULT_NOTE_LIST_WIDTH)).toBe(DEFAULT_NOTE_LIST_WIDTH);
    expect(clampPaneWidth(Number.POSITIVE_INFINITY, DEFAULT_NOTE_LIST_WIDTH)).toBe(
      DEFAULT_NOTE_LIST_WIDTH,
    );
  });
});
