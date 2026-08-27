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
 * How long the synthetic mouse burst is swallowed after a press fires.
 *
 * A ceiling, not a duration: the listeners remove themselves on the first
 * `click`, and this only covers the case where no click ever arrives (the
 * finger lifted outside the element, the page navigated).
 */
const SYNTHETIC_MOUSE_WINDOW_MS = 1000;

/**
 * Swallows the compatibility mouse events a browser fires after a touch.
 *
 * After a touch sequence Chromium — and every mobile browser — replays it as
 * `mousedown`, `mouseup`, `click` so that pointer-unaware pages keep working.
 * Those events are indistinguishable from a real click to anything listening
 * on `document`, and `useAnchoredMenu` dismisses on exactly that: an outside
 * `mousedown` in the CAPTURE phase.
 *
 * The consequence, which cost an afternoon and which no unit test could see:
 * a long press opened the row menu and the synthetic `mousedown` closed it
 * again in the same frame, so the gesture appeared to do nothing at all. The
 * element's own `onClickCapture` cannot help — a capture listener on
 * `document` runs strictly before anything on the element.
 *
 * Returns its own disposer so a row unmounting mid-burst does not leave three
 * document listeners behind.
 */
function swallowSyntheticMouse(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (event: Event): void => {
    event.preventDefault();
    // `stopImmediatePropagation`, NOT `stopPropagation`. Both this listener and
    // `useAnchoredMenu`'s dismissal are registered on `document` in the capture
    // phase, and `stopPropagation` only stops propagation to OTHER NODES —
    // every remaining listener on the same node still runs. With the weaker
    // call the menu still closed the instant it opened, and the difference is
    // one word.
    event.stopImmediatePropagation();
  };

  const dispose = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    document.removeEventListener('mousedown', stop, true);
    document.removeEventListener('mouseup', stop, true);
    document.removeEventListener('click', onClick, true);
  };

  function onClick(event: Event): void {
    stop(event);
    // The click is the last event of the burst, so the window closes with it
    // rather than waiting out the ceiling — otherwise a deliberate second tap
    // inside the menu would be swallowed too.
    dispose();
  }

  document.addEventListener('mousedown', stop, true);
  document.addEventListener('mouseup', stop, true);
  document.addEventListener('click', onClick, true);
  timer = setTimeout(dispose, SYNTHETIC_MOUSE_WINDOW_MS);

  return dispose;
}

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
  const disposeSwallow = useRef<(() => void) | null>(null);
  /**
   * What kind of pointer opened the gesture, so `contextmenu` — which is a
   * `MouseEvent` and carries no `pointerType` of its own — can tell a
   * right-click from Android's long press.
   *
   * It decides whether the synthetic-mouse burst is swallowed, and getting it
   * wrong is not cosmetic in either direction: swallowing after a real
   * right-click eats the user's click on the menu item they then choose, and
   * not swallowing after a touch lets the burst close the menu instantly.
   */
  const lastPointerType = useRef<string>('mouse');
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
  useEffect(
    () => () => {
      cancelTimer();
      disposeSwallow.current?.();
    },
    [],
  );

  return useMemo<LongPressHandlers>(() => {
    function fire(point: PressPoint, now: number, fromTouch: boolean): void {
      firedAt.current = now;
      suppressClick.current = true;
      if (fromTouch) {
        disposeSwallow.current?.();
        disposeSwallow.current = swallowSyntheticMouse();
      }
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
        lastPointerType.current = event.pointerType;
        if (event.pointerType === 'mouse') return;
        const point = { x: event.clientX, y: event.clientY };
        origin.current = point;
        timer.current = setTimeout(() => {
          timer.current = null;
          fire(point, Date.now(), true);
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
        disposeSwallow.current?.();
        disposeSwallow.current = null;
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
        fire({ x: event.clientX, y: event.clientY }, now, lastPointerType.current !== 'mouse');
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
