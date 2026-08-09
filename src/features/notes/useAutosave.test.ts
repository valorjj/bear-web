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
    let current = '';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    current = 'a';
    act(() => result.current.schedule());
    current = 'ab';
    act(() => result.current.schedule());
    current = 'abc';
    act(() => result.current.schedule());

    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
  });

  it('writes immediately on an explicit flush', async () => {
    let current = '';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    current = 'abc';
    act(() => result.current.schedule());
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
    const current = 'seed';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({ initial: 'seed', read: () => current, save }),
    );

    act(() => result.current.flush());
    await settle();
    expect(save).not.toHaveBeenCalled();

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes pending text on unmount', async () => {
    let current = '';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({ initial: '', read: () => current, save }),
    );

    current = 'unsaved';
    act(() => result.current.schedule());
    unmount();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('unsaved');
  });

  it('discards instead of saving when the buffer is empty at unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useAutosave({ initial: '', read: () => '', save, discard }),
    );

    unmount();
    await settle();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('discards a note the user emptied out, rather than saving the empty text first', async () => {
    let current = 'had content';
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({ initial: 'had content', read: () => current, save, discard }),
    );

    current = '';
    act(() => result.current.schedule());
    unmount();
    await settle();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes on visibilitychange when the page becomes hidden', async () => {
    let current = '';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    current = 'typed';
    act(() => result.current.schedule());

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
    let current = '';
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    current = 'important';
    act(() => result.current.schedule());
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

  it('does not let a stale rejection stomp a newer, already-succeeded save', async () => {
    let current = '';
    let rejectSave1: (error: Error) => void = () => {};
    let resolveSave2: () => void = () => {};

    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectSave1 = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave2 = resolve;
          }),
      );

    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    // Save1 starts for 'a'.
    current = 'a';
    act(() => result.current.schedule());
    act(() => result.current.flush());

    // The user keeps typing; Save2 starts for 'ab' while Save1 is still in flight.
    current = 'ab';
    act(() => result.current.schedule());
    act(() => result.current.flush());

    // Save2 resolves first: 'ab' is genuinely persisted.
    resolveSave2();
    await settle();

    // Save1 then rejects — stale, and must not stomp the marker Save2 set,
    // nor report a failure that no longer reflects the current buffer.
    rejectSave1(new Error('stale failure'));
    await settle();

    expect(result.current.failed).toBe(false);

    // Confirm the saved marker still reflects 'ab': flushing unchanged text
    // must not trigger a redundant write.
    act(() => result.current.flush());
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale, later-resolving success clear a failure reported by a newer save', async () => {
    let current = '';
    let resolveSave1: () => void = () => {};
    let rejectSave2: (error: Error) => void = () => {};

    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave1 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectSave2 = reject;
          }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutosave({ initial: '', read: () => current, save }));

    // Save1 starts for 'a'.
    current = 'a';
    act(() => result.current.schedule());
    act(() => result.current.flush());

    // The user keeps typing; Save2 starts for 'ab' while Save1 is still in flight.
    current = 'ab';
    act(() => result.current.schedule());
    act(() => result.current.flush());

    // Save2 (the newer save) rejects first: 'ab' was never persisted.
    rejectSave2(new Error('newer save failed'));
    await settle();

    expect(result.current.failed).toBe(true);

    // Save1 (the older, superseded save) then resolves. Its success must not
    // clear the failure that correctly describes the current buffer — doing
    // so would hide a real failure behind a stale, unrelated success.
    resolveSave1();
    await settle();

    expect(result.current.failed).toBe(true);

    // The newest text must still be retried on the next trigger.
    act(() => result.current.flush());
    await settle();

    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith('ab');
  });

  it('falls through to a normal flush on unmount when no discard is supplied, even with an empty buffer', async () => {
    let current = 'had content';
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({ initial: 'had content', read: () => current, save }),
    );

    current = '';
    act(() => result.current.schedule());
    unmount();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('');
  });
});

describe('rollback targets confirmed-persisted text', () => {
  it('retries the failed text itself, when the buffer returns to exactly what failed', async () => {
    // The defect this replaces: the old optimistic marker, after 'two' fails,
    // would still point at 'two' (the just-attempted, never-persisted text).
    // If the buffer later returned to 'two', the marker matched and the flush
    // was skipped — even though the store still only holds 'one'. The fix
    // rolls the marker back to the confirmed-persisted value ('one') instead,
    // so a buffer of 'two' never matches it and the write is retried.
    let current = 'start';
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined) // 'one' persists
      .mockRejectedValueOnce(new Error('quota')) // 'two' fails
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({ initial: 'start', read: () => current, save }),
    );

    current = 'one';
    act(() => result.current.flush());
    await act(async () => undefined);

    current = 'two';
    act(() => result.current.flush());
    await act(async () => undefined);

    // Buffer is unchanged, still 'two' — the exact text that failed to save.
    // The store only holds 'one', so this must be retried, not skipped.
    act(() => result.current.flush());
    await act(async () => undefined);

    expect(save.mock.calls.map(([text]) => text)).toEqual(['one', 'two', 'two']);
  });

  it('skips a redundant write when the buffer returns to the confirmed-persisted text', async () => {
    // The complementary case: after 'two' fails, the store still genuinely
    // holds 'one'. If the buffer returns to 'one', that text is already on
    // disk — writing it again would be a redundant, pointless save.
    let current = 'start';
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined) // 'one' persists
      .mockRejectedValueOnce(new Error('quota')) // 'two' fails
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({ initial: 'start', read: () => current, save }),
    );

    current = 'one';
    act(() => result.current.flush());
    await act(async () => undefined);

    current = 'two';
    act(() => result.current.flush());
    await act(async () => undefined);

    // Back to 'one' — the last text that actually persisted. No write needed.
    current = 'one';
    act(() => result.current.flush());
    await act(async () => undefined);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map(([text]) => text)).toEqual(['one', 'two']);
  });

  it('clears the failure flag once a later write succeeds', async () => {
    let current = 'start';
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({ initial: 'start', read: () => current, save }),
    );

    current = 'a';
    act(() => result.current.flush());
    await act(async () => undefined);
    expect(result.current.failed).toBe(true);

    current = 'b';
    act(() => result.current.flush());
    await act(async () => undefined);
    expect(result.current.failed).toBe(false);
  });

  it('does not write when the text has not changed since the last confirmed save', async () => {
    let current = 'start';
    const save = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({ initial: 'start', read: () => current, save }),
    );

    current = 'edited';
    act(() => result.current.flush());
    await act(async () => undefined);

    act(() => result.current.flush());
    await act(async () => undefined);

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('the empty predicate', () => {
  it('discards using isEmpty rather than a bare === comparison', async () => {
    const save = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const discard = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const { unmount } = renderHook(() =>
      useAutosave({
        initial: 'start',
        read: () => 'EMPTY',
        save,
        discard,
        isEmpty: (text) => text === 'EMPTY',
      }),
    );

    unmount();
    await act(async () => undefined);

    expect(discard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
