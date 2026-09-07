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

  // The flag is read once at mount, and React owns `open` from then on: a
  // later storage change — another tab, a cleared site data, a stray write —
  // cannot reopen or close the gate underneath the user. Only `dismiss` can.
  // Both directions matter: a write that clears the flag must not reopen a
  // closed gate, and a write that sets the flag must not close an open one.
  it('the gate never reopens on its own — only dismiss closes it', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const { result, rerender } = renderHook(() => useLandingGate());
    localStorage.clear();
    rerender();
    expect(result.current.open).toBe(false);
  });

  it('the gate never closes on its own — only dismiss closes it', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    const { result, rerender } = renderHook(() => useLandingGate());
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    rerender();
    expect(result.current.open).toBe(true);
  });
});
