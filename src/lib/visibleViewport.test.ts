import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { keyboardInset, useVisibleViewport, visibleBottom } from './visibleViewport';

/**
 * jsdom implements no `visualViewport` at all, which is convenient: the absent
 * case needs no setup, and the present case is installed here the same way
 * `e2e/fixtures/fakeViewport.ts` installs it in a real browser.
 */
interface FakeViewport {
  height: number;
  offsetTop: number;
  listeners: Map<string, Set<() => void>>;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  emit: (type: string) => void;
}

function installViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners = new Map<string, Set<() => void>>();
  const fake: FakeViewport = {
    height,
    offsetTop,
    listeners,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    removeEventListener: (type, handler) => void listeners.get(type)?.delete(handler),
    emit: (type) => {
      for (const handler of [...(listeners.get(type) ?? [])]) handler();
    },
  };
  Object.defineProperty(globalThis, 'visualViewport', { value: fake, configurable: true });
  return fake;
}

function setInnerHeight(height: number): void {
  Object.defineProperty(globalThis, 'innerHeight', { value: height, configurable: true });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'visualViewport', { value: undefined, configurable: true });
  setInnerHeight(768);
});

describe('visibleBottom', () => {
  it('falls back to innerHeight when there is no visualViewport', () => {
    setInnerHeight(844);
    expect(visibleBottom()).toBe(844);
  });

  it('reads the visual viewport when there is one', () => {
    setInnerHeight(844);
    installViewport(508);
    expect(visibleBottom()).toBe(508);
  });

  /**
   * The visual viewport can be SCROLLED within the layout viewport — iOS lifts
   * the page to keep a focused field above the keyboard. Its bottom edge in
   * client coordinates is `offsetTop + height`; reading `height` alone puts the
   * toolbar the offset's worth of pixels out of place, and only on the devices
   * that do the lifting.
   */
  it('includes offsetTop, because the visual viewport can be scrolled', () => {
    setInnerHeight(844);
    installViewport(508, 60);
    expect(visibleBottom()).toBe(568);
  });
});

describe('keyboardInset', () => {
  it('is zero with no keyboard', () => {
    setInnerHeight(844);
    installViewport(844);
    expect(keyboardInset()).toBe(0);
  });

  it('is the hidden height when a keyboard is open', () => {
    setInnerHeight(844);
    installViewport(508);
    expect(keyboardInset()).toBe(336);
  });

  /**
   * The property the whole two-mechanism design rests on. When
   * `interactive-widget=resizes-content` is honoured the browser shrinks the
   * LAYOUT viewport too, so both numbers agree and the JavaScript fallback has
   * nothing left to correct. If this ever returned non-zero here, the toolbar
   * would be pushed up twice.
   */
  it('is zero when the browser already resized the layout viewport', () => {
    setInnerHeight(508);
    installViewport(508);
    expect(keyboardInset()).toBe(0);
  });

  it('never goes negative', () => {
    setInnerHeight(508);
    installViewport(844);
    expect(keyboardInset()).toBe(0);
  });

  it('is zero where visualViewport is absent', () => {
    setInnerHeight(844);
    expect(keyboardInset()).toBe(0);
  });
});

describe('useVisibleViewport', () => {
  it('reports the inset on the FIRST render, not after an effect', () => {
    setInnerHeight(844);
    installViewport(508);
    const seen: number[] = [];
    renderHook(() => {
      seen.push(useVisibleViewport());
      return null;
    });
    // An effect-seeded hook would return 0 here and correct itself immediately
    // — invisible to any later assertion, and a visible jump of the toolbar
    // every time the keyboard opens.
    expect(seen[0]).toBe(336);
  });

  it('follows a resize', () => {
    setInnerHeight(844);
    const vv = installViewport(844);
    const { result } = renderHook(() => useVisibleViewport());
    expect(result.current).toBe(0);

    act(() => {
      vv.height = 508;
      vv.emit('resize');
    });
    expect(result.current).toBe(336);
  });

  /**
   * A `scroll` with no size change is what iOS emits when it lifts the page to
   * keep a focused field visible. Observing `resize` alone leaves the toolbar
   * behind on exactly that motion.
   */
  it('follows a scroll that changes no size', () => {
    setInnerHeight(844);
    const vv = installViewport(508);
    const { result } = renderHook(() => useVisibleViewport());
    expect(result.current).toBe(336);

    act(() => {
      vv.offsetTop = 60;
      vv.emit('scroll');
    });
    expect(result.current).toBe(276);
  });

  it('removes its listeners on unmount', () => {
    const vv = installViewport(844);
    const { unmount } = renderHook(() => useVisibleViewport());
    expect(vv.listeners.get('resize')!.size).toBe(1);
    unmount();
    expect(vv.listeners.get('resize')!.size).toBe(0);
    expect(vv.listeners.get('scroll')!.size).toBe(0);
  });

  it('works where visualViewport is absent', () => {
    setInnerHeight(844);
    const { result } = renderHook(() => useVisibleViewport());
    expect(result.current).toBe(0);
  });
});
