export interface Viewport {
  /** Screen-space translation applied before `scale`. */
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by `factor` about the screen point (`px`, `py`), which stays fixed.
 *
 * Separated from the hook because this is the only part with a correctness
 * condition worth asserting, and jsdom cannot drive the pointer path at all —
 * it has no `setPointerCapture`, so the drag belongs in Playwright.
 */
export function zoomAt(viewport: Viewport, factor: number, px: number, py: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;

  const ratio = scale / viewport.scale;
  return {
    x: px - (px - viewport.x) * ratio,
    y: py - (py - viewport.y) * ratio,
    scale,
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale };
}

/**
 * Screen-space distance from a pointerdown to its current position, in
 * pixels this small, is indistinguishable from hand tremor on a real click —
 * below it, a gesture must be treated as a click, not a drag.
 */
export const DRAG_THRESHOLD_PX = 3;

/**
 * Whether a pointer has moved far enough from its down position to count as
 * a drag rather than a click.
 *
 * Pulled out as pure, unit-testable logic for exactly one reason: capturing
 * the pointer on every `pointerdown` — even one that never moves — is what
 * retargets the browser's own synthesized `click` event to the capturing
 * element instead of whatever was actually under the cursor, silently
 * breaking click-to-select. `usePanZoom` defers `setPointerCapture` until
 * this returns `true`. See `usePanZoom.ts`'s `onPointerDown` docblock and
 * `.superpowers/sdd/2026-08-31-l3-relationship-graph/task-10-report.md`
 * for the full story — jsdom has no `setPointerCapture` at all, so nothing
 * short of Playwright could ever have caught the original bug.
 */
export function passedDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}
