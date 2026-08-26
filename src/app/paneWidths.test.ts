import { describe, expect, it } from 'vitest';

import {
  clampPaneWidth,
  DEFAULT_NOTE_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PANE_WIDTH,
  maxPaneWidth,
  MIN_PANE_WIDTH,
  SHELL_CHROME_WIDTH,
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

describe('maxPaneWidth', () => {
  it('allows the full maximum when the viewport is wide', () => {
    expect(maxPaneWidth(1920, DEFAULT_NOTE_LIST_WIDTH)).toBe(MAX_PANE_WIDTH);
  });

  it('leaves the third pane at least its minimum in a narrow window', () => {
    // The bug this closes: both panes dragged wide in a 1024px window pushed
    // the editor to a NEGATIVE width, because each pane was clamped only
    // against 160..560 and never against the room actually available.
    const room = maxPaneWidth(1024, DEFAULT_NOTE_LIST_WIDTH);

    expect(1024 - room - DEFAULT_NOTE_LIST_WIDTH - SHELL_CHROME_WIDTH).toBeGreaterThanOrEqual(
      MIN_PANE_WIDTH,
    );
  });

  it('is tighter in a narrow window than in a wide one', () => {
    // Guards against a formula that returns MAX_PANE_WIDTH regardless, which
    // would satisfy the bound above vacuously.
    expect(maxPaneWidth(1024, DEFAULT_NOTE_LIST_WIDTH)).toBeLessThan(
      maxPaneWidth(1920, DEFAULT_NOTE_LIST_WIDTH),
    );
  });

  it('never returns less than the minimum, however cramped', () => {
    // Below the desktop breakpoint no resizer renders, so this is defence
    // rather than a reachable state — but a zero or negative maximum would
    // make `clampPaneWidth` invert its own bounds.
    expect(maxPaneWidth(320, DEFAULT_NOTE_LIST_WIDTH)).toBe(MIN_PANE_WIDTH);
  });
});

describe('clampPaneWidth with an explicit maximum', () => {
  it('honours a maximum below MAX_PANE_WIDTH', () => {
    expect(clampPaneWidth(9999, DEFAULT_SIDEBAR_WIDTH, 300)).toBe(300);
  });

  it('still honours the floor when the maximum is below it', () => {
    expect(clampPaneWidth(10, DEFAULT_SIDEBAR_WIDTH, 100)).toBe(MIN_PANE_WIDTH);
  });

  it('is unchanged when no maximum is given', () => {
    expect(clampPaneWidth(9999)).toBe(MAX_PANE_WIDTH);
  });
});
