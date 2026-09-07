import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LANDING_SEEN_KEY } from './gate';
import { useLandingGate } from './useLandingGate';

afterEach(() => localStorage.clear());

describe('useLandingGate', () => {
  it('opens when the flag is absent', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    const { result } = renderHook(() => useLandingGate());
    expect(result.current.open).toBe(true);
  });

  it('stays closed when the flag is present', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const { result } = renderHook(() => useLandingGate());
    expect(result.current.open).toBe(false);
  });

  it('closes and persists on dismiss', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    const { result } = renderHook(() => useLandingGate());
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(LANDING_SEEN_KEY)).toBe('1');
  });

  // The flag is read in a lazy initialiser, so it is read once at mount and
  // never again. Without that, a re-render would re-read storage on the
  // render path — cheap here, but the wrong shape, and it makes `dismiss`
  // the only thing that can close the gate.
  it('does not reopen when storage is cleared after mount', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const { result, rerender } = renderHook(() => useLandingGate());
    localStorage.clear();
    rerender();
    expect(result.current.open).toBe(false);
  });
});
