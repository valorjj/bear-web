import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOverlayHistory } from './useOverlayHistory';

// A failing `expect` throws before a test's own `mockRestore()` can run, which
// leaves the spy installed and makes the NEXT test's spy wrap it and
// double-count. One real failure then presents as two, and the second one
// points at innocent code. Restore centrally instead.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOverlayHistory', () => {
  it('pushes exactly one history entry when the overlay opens', () => {
    const push = vi.spyOn(history, 'pushState');

    renderHook(() => useOverlayHistory(true, vi.fn(), 'drawer'));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toEqual({ bearOverlay: 'drawer' });
  });

  it('leaves the URL alone', () => {
    // Deliberate: no URL scheme to design, no GitHub Pages sub-path to get
    // wrong, and no 404 on refresh.
    const push = vi.spyOn(history, 'pushState');
    const before = location.href;

    renderHook(() => useOverlayHistory(true, vi.fn(), 'drawer'));

    expect(push.mock.calls[0][2]).toBe(before);
    expect(location.href).toBe(before);
  });

  it('pushes nothing while the overlay is closed', () => {
    const push = vi.spyOn(history, 'pushState');

    renderHook(() => useOverlayHistory(false, vi.fn(), 'drawer'));

    expect(push).not.toHaveBeenCalled();
  });

  it('leaves exactly ONE net entry on the stack under StrictMode', () => {
    // StrictMode mounts, cleans up, and mounts again. Two surviving entries
    // would mean the user needs two backs to dismiss one drawer — the exact
    // shape of the `useSession` defect that passed all six gates and was found
    // only by running the app.
    //
    // The invariant is the NET, not the call count. StrictMode's phantom cycle
    // legitimately pushes twice and consumes one of them, and asserting
    // `pushState` was called once would fail a correct implementation while
    // telling us nothing about the stack the user actually has.
    const push = vi.spyOn(history, 'pushState');
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});

    renderHook(() => useOverlayHistory(true, vi.fn(), 'drawer'), { wrapper: StrictMode });

    expect(push.mock.calls.length - back.mock.calls.length).toBe(1);
  });

  it('closes the overlay on popstate', () => {
    const onClose = vi.fn();
    renderHook(() => useOverlayHistory(true, onClose, 'drawer'));

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('consumes its own entry when the overlay closes by another route', () => {
    // Closing via a back chevron or Escape must not leave a dead entry on the
    // stack: the next back press would then do nothing visible.
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useOverlayHistory(open, vi.fn(), 'drawer'),
      { initialProps: { open: true } },
    );

    rerender({ open: false });

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('does not call back after a popstate already consumed the entry', () => {
    // Otherwise the browser goes back TWICE for one press and the user is
    // thrown out of the app entirely.
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useOverlayHistory(open, vi.fn(), 'drawer'),
      { initialProps: { open: true } },
    );

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    rerender({ open: false });

    expect(back).not.toHaveBeenCalled();
  });

  it('does not re-push when only the onClose identity changes', () => {
    // A caller passing an inline arrow re-renders with a new function every
    // time; making that a dependency would tear down and re-push the entry on
    // every render, filling the history stack.
    const push = vi.spyOn(history, 'pushState');
    const { rerender } = renderHook(() => useOverlayHistory(true, () => {}, 'drawer'));

    rerender();
    rerender();

    expect(push).toHaveBeenCalledTimes(1);
  });
});
