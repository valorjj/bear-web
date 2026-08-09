import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFlushTriggers } from './useFlushTriggers';

function hide(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function show(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useFlushTriggers', () => {
  it('flushes when the document becomes hidden', () => {
    const flush = vi.fn();
    renderHook(() => useFlushTriggers(flush));

    hide();

    expect(flush).toHaveBeenCalledTimes(1);
    show();
  });

  it('does not flush when the document becomes visible', () => {
    const flush = vi.fn();
    renderHook(() => useFlushTriggers(flush));

    show();

    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes on beforeunload', () => {
    const flush = vi.fn();
    renderHook(() => useFlushTriggers(flush));

    window.dispatchEvent(new Event('beforeunload'));

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('calls the latest callback, not the one captured on mount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ flush }) => useFlushTriggers(flush), {
      initialProps: { flush: first },
    });

    rerender({ flush: second });
    window.dispatchEvent(new Event('beforeunload'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const flush = vi.fn();
    const { unmount } = renderHook(() => useFlushTriggers(flush));

    unmount();
    window.dispatchEvent(new Event('beforeunload'));
    hide();

    expect(flush).not.toHaveBeenCalled();
    show();
  });
});
