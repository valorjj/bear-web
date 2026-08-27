import { type MouseEvent, type PointerEvent, useEffect, useMemo, useRef } from 'react';

/** Where the gesture happened, in client coordinates. */
export interface PressPoint {
  x: number;
  y: number;
}

export interface UseLongPressOptions {
  /**
   * Called once per gesture, whichever of the three triggers below arrives
   * first.
   */
  onPress: (point: PressPoint) => void;
  /**
   * How long a finger must rest before the gesture fires. 500ms matches what
   * iOS and Android use for their own long-press, so a user's muscle memory
   * transfers.
   */
  delayMs?: number;
  /**
   * How far a finger may drift and still count as a press. Below this a press
   * is a press; above it the user is scrolling, and firing a menu into a scroll
   * is the single worst thing this gesture can do.
   */
  moveTolerancePx?: number;
}

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onClickCapture: (event: MouseEvent) => void;
}

/**
 * How long after firing a native `contextmenu` is treated as the same gesture.
 *
 * Android Chrome raises `contextmenu` from a long press at very close to the
 * same moment our timer does, and the order is not guaranteed. Without this
 * window the two triggers open the menu twice — visibly, because the second
 * open re-anchors it.
 */
const DEDUPE_WINDOW_MS = 1000;

/**
 * One secondary-action gesture, three triggers, fired once.
 *
 * The triggers exist because no single one covers the platforms:
 *
 * - a mouse `contextmenu` (right-click) — desktop, and the only route before J2;
 * - a touch `contextmenu` — Android Chrome raises one from a long press;
 * - a timer — **iOS Safari raises no `contextmenu` at all** from a long press,
 *   so on an iPhone the timer is the only thing that can fire.
 *
 * Collapsing these into "just use `contextmenu`" ships a phone build where the
 * row menu works on Android and silently does nothing on iOS, which is the
 * failure this hook exists to prevent. Collapsing them into "just use a timer"
 * fights Android's own gesture recogniser instead.
 *
 * The hook does NOT test the pointer type to decide whether to run: it starts a
 * timer for any non-mouse pointer and lets the dedupe window sort out whichever
 * trigger wins. A pen is a non-mouse pointer that may or may not raise
 * `contextmenu`, and guessing which was measurably worse than handling both.
 */
export function useLongPress({
  onPress,
  delayMs = 500,
  moveTolerancePx = 10,
}: UseLongPressOptions): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<PressPoint | null>(null);
  const firedAt = useRef<number | null>(null);
  // Read by `onClickCapture`. A touch that fires the menu still produces a
  // `click` afterwards, and on this row that click SELECTS THE NOTE — so
  // without suppression, long-pressing a row both opens its menu and navigates
  // to it, which on a phone means the menu opens over a screen the user did
  // not ask for.
  const suppressClick = useRef(false);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  function cancelTimer(): void {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }

  // A pending timer must not outlive the row. Note-list rows unmount
  // constantly — a scope change replaces every one of them — and a timer that
  // survives calls `onPress` for a note that is no longer on screen.
  useEffect(() => cancelTimer, []);

  return useMemo<LongPressHandlers>(() => {
    function fire(point: PressPoint, now: number): void {
      firedAt.current = now;
      suppressClick.current = true;
      onPressRef.current(point);
    }

    function firedRecently(now: number): boolean {
      return firedAt.current !== null && now - firedAt.current < DEDUPE_WINDOW_MS;
    }

    return {
      onPointerDown(event) {
        cancelTimer();
        suppressClick.current = false;
        // A mouse has `contextmenu` and always has. Starting a timer for it
        // would mean holding the left button down opened a menu, which no
        // desktop app does.
        if (event.pointerType === 'mouse') return;
        const point = { x: event.clientX, y: event.clientY };
        origin.current = point;
        timer.current = setTimeout(() => {
          timer.current = null;
          fire(point, Date.now());
        }, delayMs);
      },

      onPointerMove(event) {
        if (timer.current === null || origin.current === null) return;
        const dx = event.clientX - origin.current.x;
        const dy = event.clientY - origin.current.y;
        // Squared distance, so the comparison needs no square root — and more
        // to the point, no floating-point surprise at exactly the tolerance.
        if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) cancelTimer();
      },

      onPointerUp() {
        cancelTimer();
      },

      onPointerCancel() {
        cancelTimer();
        // The gesture was taken over by something else — a scroll, a system
        // sheet. Any click that follows is not ours to swallow.
        suppressClick.current = false;
      },

      onContextMenu(event) {
        const now = Date.now();
        cancelTimer();
        // Our timer already opened the menu. Let the platform's own menu stay
        // shut rather than opening a second one over ours.
        if (firedRecently(now)) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        fire({ x: event.clientX, y: event.clientY }, now);
      },

      onClickCapture(event) {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }, [delayMs, moveTolerancePx]);
}
