import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { useLongPress, type PressPoint } from './useLongPress';

/**
 * A row-shaped harness: a container carrying the gesture handlers, wrapping a
 * button whose click is what a real note row would use to navigate. Both are
 * needed — the click suppression only means anything if there is a click
 * handler underneath to suppress.
 */
function Harness({
  onPress,
  onClick,
}: {
  onPress: (p: PressPoint) => void;
  onClick: () => void;
}): ReactElement {
  const handlers = useLongPress({ onPress });
  return (
    <div {...handlers} data-testid="row">
      <button type="button" onClick={onClick}>
        row
      </button>
    </div>
  );
}

function pointer(
  type: string,
  init: PointerEventInit & { pointerType?: string } = {},
): PointerEvent {
  // jsdom has `PointerEvent` only as an alias of `MouseEvent` in some versions,
  // and `pointerType` is not in `MouseEventInit`. Construct the event and pin
  // the field on directly rather than trusting the constructor to carry it.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }) as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'touch' });
  return event;
}

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const onPress = vi.fn();
    const onClick = vi.fn();
    render(<Harness onPress={onPress} onClick={onClick} />);
    return { onPress, onClick, row: screen.getByTestId('row') };
  }

  it('fires after the delay when a finger rests', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 40, clientY: 60 }));
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onPress).toHaveBeenCalledWith({ x: 40, y: 60 });
  });

  it('does not fire before the delay', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(499);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire when the finger is scrolling', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    row.dispatchEvent(pointer('pointermove', { clientX: 0, clientY: 40 }));
    vi.advanceTimersByTime(500);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('tolerates a small drift', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    row.dispatchEvent(pointer('pointermove', { clientX: 3, clientY: 3 }));
    vi.advanceTimersByTime(500);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('does not fire when the finger lifts early', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(200);
    row.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(500);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('starts no timer for a mouse', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(2000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('fires immediately on a right-click', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('contextmenu', { pointerType: 'mouse', clientX: 12, clientY: 34 }));
    expect(onPress).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  /**
   * Android Chrome raises `contextmenu` from a long press at very close to the
   * moment the timer fires, in an order that is not guaranteed. Both orders
   * must produce exactly one menu.
   */
  it('fires once when a timer and a native contextmenu both arrive', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(500);
    row.dispatchEvent(pointer('contextmenu', { clientX: 5, clientY: 5 }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('fires once when the native contextmenu arrives first', () => {
    const { onPress, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(300);
    row.dispatchEvent(pointer('contextmenu', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(500);
    expect(onPress).toHaveBeenCalledOnce();
  });

  /**
   * The failure this prevents is not cosmetic: on a note row the click SELECTS
   * the note, so an unsuppressed click means long-pressing a row opens its menu
   * over an editor screen the user never asked for.
   */
  it('swallows the click that follows a fired press', () => {
    const { onPress, onClick, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(500);
    expect(onPress).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a click through when no press fired', () => {
    const { onClick } = setup();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets a click through after the gesture is cancelled', () => {
    const { onClick, row } = setup();
    row.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(500);
    row.dispatchEvent(pointer('pointercancel'));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
