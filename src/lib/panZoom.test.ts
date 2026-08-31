import { describe, expect, it } from 'vitest';

import {
  clampScale,
  DRAG_THRESHOLD_PX,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  passedDragThreshold,
  zoomAt,
} from './panZoom';

describe('clampScale', () => {
  it('holds the scale inside its bounds', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    // The whole correctness condition for wheel zoom, and the one thing that
    // is obviously wrong on screen when it is wrong: the graph slides away
    // from the pointer.
    const before = { x: 0, y: 0, scale: 1 };
    const after = zoomAt(before, 2, 100, 50);

    const worldBefore = { x: (100 - before.x) / before.scale, y: (50 - before.y) / before.scale };
    const worldAfter = { x: (100 - after.x) / after.scale, y: (50 - after.y) / after.scale };

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  it('does not drift the origin when the scale is already clamped', () => {
    const at = { x: 10, y: 20, scale: MAX_SCALE };

    expect(zoomAt(at, 4, 100, 50)).toEqual(at);
  });
});

describe('panBy', () => {
  it('translates without touching the scale', () => {
    expect(panBy({ x: 5, y: 5, scale: 2 }, 10, -3)).toEqual({ x: 15, y: 2, scale: 2 });
  });
});

describe('passedDragThreshold', () => {
  it('is false for a pointer that has not moved at all', () => {
    expect(passedDragThreshold(0, 0)).toBe(false);
  });

  it('is false just under the threshold', () => {
    expect(passedDragThreshold(DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it('is true at and beyond the threshold, on either axis', () => {
    expect(passedDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(passedDragThreshold(0, DRAG_THRESHOLD_PX)).toBe(true);
    expect(passedDragThreshold(100, 100)).toBe(true);
  });

  it('measures the hypotenuse, not either axis alone', () => {
    // Two components, each individually under the threshold, whose combined
    // Euclidean distance clears it: 0.8 * threshold on both axes is
    // ~1.13 * threshold as a hypotenuse.
    const small = DRAG_THRESHOLD_PX * 0.8;
    expect(passedDragThreshold(small, 0)).toBe(false);
    expect(passedDragThreshold(small, small)).toBe(true);
  });
});
