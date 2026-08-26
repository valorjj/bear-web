import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DESKTOP_MIN_WIDTH, TABLET_MIN_WIDTH, useLayoutMode } from './useLayoutMode';

describe('useLayoutMode', () => {
  it.each([
    [390, 'phone'],
    [TABLET_MIN_WIDTH - 1, 'phone'],
    [TABLET_MIN_WIDTH, 'tablet'],
    [834, 'tablet'],
    [DESKTOP_MIN_WIDTH - 1, 'tablet'],
    [DESKTOP_MIN_WIDTH, 'desktop'],
    [1280, 'desktop'],
  ])('reports %ipx as %s', (width, expected) => {
    globalThis.__setViewportWidth(width);

    const { result } = renderHook(() => useLayoutMode());

    expect(result.current).toBe(expected);
  });

  it('updates when the viewport crosses a breakpoint', () => {
    // The whole point of a hook over a one-time read: rotating a phone, or
    // dragging a desktop window across the breakpoint, has to re-render.
    globalThis.__setViewportWidth(1280);
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current).toBe('desktop');

    act(() => globalThis.__setViewportWidth(390));

    expect(result.current).toBe('phone');
  });

  it('reads the width during the FIRST render, not from an effect', () => {
    // An effect-seeded hook renders once as the wrong mode before correcting
    // itself, which is a visible layout flash on every load. Asserting on the
    // FIRST value the hook ever returned is what catches that; asserting on
    // the settled value would pass either way.
    globalThis.__setViewportWidth(390);
    const seen: string[] = [];

    renderHook(() => {
      seen.push(useLayoutMode());
    });

    expect(seen[0]).toBe('phone');
  });
});
