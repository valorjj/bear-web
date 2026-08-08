import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOSAVE_DELAY_MS, useAutosave } from './useAutosave';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets queued promise callbacks run while fake timers are installed. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAutosave', () => {
  it('coalesces a burst of edits into a single write', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', save }));

    act(() => result.current.setText('a'));
    act(() => result.current.setText('ab'));
    act(() => result.current.setText('abc'));

    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
  });

  it('exposes the buffer synchronously, before any write', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: 'seed', save }));

    expect(result.current.text).toBe('seed');
    act(() => result.current.setText('typed'));
    expect(result.current.text).toBe('typed');
  });

  it('writes immediately on an explicit flush', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', save }));

    act(() => result.current.setText('abc'));
    act(() => result.current.flush());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');

    // The pending timer must have been cancelled, not merely beaten.
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not write when the buffer matches what was already saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: 'seed', save }));

    act(() => result.current.flush());
    await settle();
    expect(save).not.toHaveBeenCalled();

    act(() => result.current.setText('seed'));
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes pending text on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave({ initial: '', save }));

    act(() => result.current.setText('unsaved'));
    unmount();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('unsaved');
  });

  it('discards instead of saving when the buffer is empty at unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave({ initial: '', save, discard }));

    unmount();
    await settle();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('discards a note the user emptied out, rather than saving the empty text first', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({ initial: 'had content', save, discard }),
    );

    act(() => result.current.setText(''));
    unmount();
    await settle();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes on visibilitychange when the page becomes hidden', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', save }));

    act(() => result.current.setText('typed'));

    // jsdom defines `visibilityState` as a prototype getter, which `vi.spyOn`
    // cannot reliably intercept on the instance. Redefine it directly.
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('typed');

    // `Document.visibilityState` is typed readonly, so a plain `delete` on a
    // `Partial<Document>` cast still fails `tsc`'s read-only check (TS2704).
    // `Reflect.deleteProperty` performs the identical runtime operation
    // without the static restriction.
    Reflect.deleteProperty(document, 'visibilityState');
    if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);
  });

  it('reports a failed save and retries the same text on the next trigger', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutosave({ initial: '', save }));

    act(() => result.current.setText('important'));
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.failed).toBe(true);

    // The same text must be retried: the failure must not have been recorded
    // as "saved". Losing this is silent data loss.
    act(() => result.current.flush());
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('important');
    expect(result.current.failed).toBe(false);
  });
});
