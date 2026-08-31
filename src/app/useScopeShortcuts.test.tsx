import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { smartScope } from '@/features/notes';

import { useScopeShortcuts } from './useScopeShortcuts';

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function mount(overrides: Partial<Parameters<typeof useScopeShortcuts>[0]> = {}) {
  const handlers = {
    onScope: vi.fn(),
    onSearch: vi.fn(),
    onGraph: vi.fn(),
    enabled: true,
    ...overrides,
  };
  const view = renderHook(() => useScopeShortcuts(handlers));
  return { ...handlers, ...view };
}

describe('useScopeShortcuts', () => {
  it('switches scope on Meta+Shift+digit', () => {
    const { onScope } = mount();

    press({ code: 'Digit3', key: '#', metaKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('todo'));
  });

  it('matches on code, not key: Shift+1 reports key "!" on a US layout', () => {
    const { onScope } = mount();

    press({ code: 'Digit1', key: '!', metaKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('all'));
  });

  it('accepts Control as the modifier, for Windows and Linux', () => {
    const { onScope } = mount();

    press({ code: 'Digit0', key: ')', ctrlKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('trash'));
  });

  it('binds pinned to 5 and locked to 6, following the sidebar rather than Bear', () => {
    const { onScope } = mount();

    press({ code: 'Digit5', key: '%', metaKey: true, shiftKey: true });
    press({ code: 'Digit6', key: '^', metaKey: true, shiftKey: true });

    expect(onScope).toHaveBeenNthCalledWith(1, smartScope('pinned'));
    expect(onScope).toHaveBeenNthCalledWith(2, smartScope('locked'));
  });

  it('ignores the combination when Alt is held, so it cannot fire alongside a heading toggle', () => {
    // ⌥⌘1-6 are @tiptap/extension-heading's `Mod-Alt-${level}`. A stray
    // ⌥⇧⌘1 must not both make an H1 and switch scope.
    const { onScope } = mount();

    press({ code: 'Digit1', key: '¡', metaKey: true, shiftKey: true, altKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('ignores 7, 8 and 9, which belong to the list and blockquote extensions', () => {
    const { onScope } = mount();

    press({ code: 'Digit7', key: '&', metaKey: true, shiftKey: true });
    press({ code: 'Digit8', key: '*', metaKey: true, shiftKey: true });
    press({ code: 'Digit9', key: '(', metaKey: true, shiftKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('ignores a digit without Shift, which is the browser tab-switching family', () => {
    const { onScope } = mount();

    press({ code: 'Digit1', key: '1', metaKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('ignores a digit with no modifier at all, so typing is unaffected', () => {
    const { onScope } = mount();

    press({ code: 'Digit1', key: '1' });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('still handles the search shortcut it took over from AppShell', () => {
    const { onSearch } = mount();

    press({ code: 'KeyF', key: 'f', metaKey: true });

    expect(onSearch).toHaveBeenCalled();
  });

  it('does nothing at all while disabled, so a modal keeps its focus trap', () => {
    const { onScope, onSearch } = mount({ enabled: false });

    press({ code: 'Digit3', key: '#', metaKey: true, shiftKey: true });
    press({ code: 'KeyF', key: 'f', metaKey: true });

    expect(onScope).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('opens the graph on Mod+Shift+G', () => {
    const { onGraph } = mount();

    press({ code: 'KeyG', key: 'g', metaKey: true, shiftKey: true });

    expect(onGraph).toHaveBeenCalledTimes(1);
  });

  it('leaves Mod+Alt+Shift+G alone, so it cannot fire alongside a heading toggle', () => {
    // Alt is rejected rather than merely unmatched, for the same reason the
    // digits reject it: one keystroke must not fire two unrelated effects.
    const { onGraph } = mount();

    press({ code: 'KeyG', key: 'g', metaKey: true, shiftKey: true, altKey: true });

    expect(onGraph).not.toHaveBeenCalled();
  });

  it('detaches its listener on unmount', () => {
    const { onScope, unmount } = mount();

    unmount();
    press({ code: 'Digit3', key: '#', metaKey: true, shiftKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });
});
