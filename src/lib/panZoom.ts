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

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Clear space, in graph-space units, kept between the framed bounds and the container edge. */
export const FRAME_PADDING = 48;

/** The bounding box of a set of points. `{0,0,0,0}` for an empty set. */
export function boundsOf(points: readonly { x: number; y: number }[]): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The viewport that centres `bounds` inside a `width` x `height` container,
 * with `FRAME_PADDING` clear on every side, never upscaling past 1x.
 *
 * This is what makes the graph open FRAMED. `layoutGraph` centres the layout
 * on graph-space `(0, 0)`, but the canvas carried no notion of the
 * container's actual size and started every session at
 * `{ x: 0, y: 0, scale: 1 }` — which puts graph-space origin at the SVG's
 * own top-left corner, not its centre, so roughly half of any real layout
 * rendered off-screen until the reader panned it into view by hand. This
 * function is also what "Reset zoom" returns to, so resetting lands on the
 * same correct framing rather than the old corner.
 */
export function frameBounds(bounds: Bounds, width: number, height: number): Viewport {
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fitScale = Math.min(
    (width - FRAME_PADDING * 2) / boundsWidth,
    (height - FRAME_PADDING * 2) / boundsHeight,
  );
  const scale = clampScale(Number.isFinite(fitScale) ? Math.min(1, fitScale) : 1);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;

  return {
    x: width / 2 - centreX * scale,
    y: height / 2 - centreY * scale,
    scale,
  };
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
 * this returns `true`. See `usePanZoom.ts`'s `onPointerDown` docblock for the
 * full story — jsdom has no `setPointerCapture` at all, so nothing short of
 * Playwright could ever have caught the original bug; `e2e/graph.spec.ts`'s
 * click-to-open-a-note test is what now exercises the real path.
 */
export function passedDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}
