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
