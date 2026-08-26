export const SIDEBAR_WIDTH_KEY = 'pane.sidebarWidth';
export const NOTE_LIST_WIDTH_KEY = 'pane.noteListWidth';

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_NOTE_LIST_WIDTH = 320;

export const MIN_PANE_WIDTH = 160;
export const MAX_PANE_WIDTH = 560;

/**
 * Everything in the shell that is neither of the two sized panes nor the
 * editor: `<main>`'s padding either side, the flex gaps between the five
 * children, and the two resizer tracks.
 *
 * A constant rather than a live measurement, and therefore falsifiable rather
 * than merely asserted: `e2e/mobile.spec.ts` drags both panes to their maximum
 * at 1024px and asserts the editor still measures at least `MIN_PANE_WIDTH`.
 * If the shell's padding or gaps ever change, that test fails and this number
 * is what to fix.
 */
export const SHELL_CHROME_WIDTH = 56;

/**
 * The widest one pane may be drawn without squeezing the editor below
 * `MIN_PANE_WIDTH`.
 *
 * Closes a pre-existing bug rather than serving the mobile work directly:
 * `clampPaneWidth` bounded each pane to 160..560 with no knowledge of the
 * viewport, so a sidebar and a note list both dragged wide in a 1024px window
 * left the editor a NEGATIVE width.
 */
export function maxPaneWidth(viewportWidth: number, otherPaneWidth: number): number {
  const room = viewportWidth - otherPaneWidth - SHELL_CHROME_WIDTH - MIN_PANE_WIDTH;
  return Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, room));
}

/**
 * Keeps a pane usable regardless of what a drag, a stale setting, or a bad
 * import supplies.
 *
 * `max` is optional and defaults to `MAX_PANE_WIDTH`, so every call site that
 * predates the viewport-aware clamp behaves exactly as it did. The floor wins
 * over the ceiling when the two cross — a `max` below `MIN_PANE_WIDTH` in a
 * very narrow window must not invert the bounds and return the ceiling.
 */
export function clampPaneWidth(
  width: number,
  fallback: number = DEFAULT_SIDEBAR_WIDTH,
  max: number = MAX_PANE_WIDTH,
): number {
  if (!Number.isFinite(width)) return fallback;
  return Math.min(Math.max(max, MIN_PANE_WIDTH), Math.max(MIN_PANE_WIDTH, Math.round(width)));
}
