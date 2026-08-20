import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';

import { MIRROR_KEY, THEME_KEY } from './theme';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    await settings.remove(THEME_KEY);
  });

  it('defaults to system with nothing stored', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.choice).toBe('system'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies a chosen theme to the document', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('high-contrast'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('high-contrast');
  });

  it('persists the choice durably', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('ink'));
    await waitFor(async () => {
      expect(await settings.get(THEME_KEY, 'system')).toBe('ink');
    });
  });

  it('writes the mirror so the next launch paints correctly', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('indigo-dark'));
    expect(localStorage.getItem(MIRROR_KEY)).toBe('indigo-dark');
  });

  // The settings table outranks the mirror. A mirror left behind by an older
  // build, or edited by hand, must not survive a launch.
  it('rewrites a mirror that disagrees with the stored value', async () => {
    localStorage.setItem(MIRROR_KEY, 'paper');
    await settings.set(THEME_KEY, 'indigo-dark');
    renderHook(() => useTheme());
    await waitFor(() => {
      expect(localStorage.getItem(MIRROR_KEY)).toBe('indigo-dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('indigo-dark');
  });

  it('returns to system, removing the attribute', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('ink'));
    await act(async () => result.current.setChoice('system'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
