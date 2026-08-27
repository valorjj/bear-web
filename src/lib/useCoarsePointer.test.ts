import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOVER_NONE_QUERY, useCoarsePointer } from './useCoarsePointer';

describe('useCoarsePointer', () => {
  it('reports a mouse by default', () => {
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('reports a fingertip when the pointer is coarse', () => {
    globalThis.__setPointerCoarse(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  /**
   * The only assertion that can tell a render-time seed from an effect-time
   * one. An effect-seeded hook would return `false` on its first render and
   * correct itself immediately afterwards — invisible to any assertion made
   * after `renderHook` returns, and a painted frame of the wrong behaviour in
   * a real browser.
   */
  it('is coarse on the FIRST render, not after an effect', () => {
    globalThis.__setPointerCoarse(true);
    const seen: boolean[] = [];
    renderHook(() => {
      seen.push(useCoarsePointer());
      return null;
    });
    expect(seen[0]).toBe(true);
  });

  it('follows a change in the primary pointer', () => {
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
    act(() => globalThis.__setPointerCoarse(true));
    expect(result.current).toBe(true);
  });

  /**
   * J2 keeps two queries deliberately. Collapsing them into one constant would
   * pass every other test in this file, so this is the only thing standing
   * between the design decision and a well-meaning simplification.
   */
  it('keeps the hover query distinct from the pointer query', () => {
    expect(HOVER_NONE_QUERY).toBe('(hover: none)');
  });
});
