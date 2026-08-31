import { describe, expect, it } from 'vitest';

import { clampScale, MAX_SCALE, MIN_SCALE, panBy, zoomAt } from './panZoom';

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
