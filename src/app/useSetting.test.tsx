import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, settings } from '@/data';

import { useSetting } from './useSetting';

const isSize = (value: unknown): value is 'small' | 'large' =>
  value === 'small' || value === 'large';

describe('useSetting', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.settings.clear();
  });

  it('renders the fallback before the stored value resolves', () => {
    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));
    expect(result.current[0]).toBe('large');
  });

  it('reads a stored value back', async () => {
    await settings.set('previewSize', 'small');

    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));

    await waitFor(() => expect(result.current[0]).toBe('small'));
  });

  it('persists a written value', async () => {
    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));

    act(() => result.current[1]('small'));

    await waitFor(async () => {
      expect(await settings.get('previewSize', 'large')).toBe('small');
    });
  });

  it('falls back when the stored value fails its guard', async () => {
    // A row written by a future version, or edited by hand in devtools. It must
    // never reach the consumer as a value it cannot handle — `compareNotes`
    // switches exhaustively, so an unknown field falls through every arm.
    await settings.set('previewSize', 'enormous');

    // Two hooks on ONE key: the permissive one is the propagation probe. Its
    // value is what tells us the live query has actually delivered the stored
    // row to a hook — without it, asserting on the strict hook would read the
    // pre-resolution fallback and pass whether or not the guard exists. That
    // is exactly how this test was written first, and deleting the guard did
    // not fail it.
    const { result } = renderHook(() => ({
      strict: useSetting('previewSize', 'large', isSize),
      permissive: useSetting(
        'previewSize',
        'large',
        (v): v is 'small' | 'large' => v !== undefined,
      ),
    }));

    await waitFor(() => expect(result.current.permissive[0]).toBe('enormous'));
    expect(result.current.strict[0]).toBe('large');
  });
});
