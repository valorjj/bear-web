import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

import { panBy, passedDragThreshold, type Viewport, zoomAt } from './panZoom';

export interface PanZoom {
  viewport: Viewport;
  onPointerDown: (event: PointerEvent<Element>) => void;
  onPointerMove: (event: PointerEvent<Element>) => void;
  onPointerUp: (event: PointerEvent<Element>) => void;
  onWheel: (event: WheelEvent<Element>) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
}

interface Drag {
  id: number;
  /** Where the gesture started — fixed, used only to test the drag threshold. */
  startX: number;
  startY: number;
  /** Where the gesture was last seen — updated every move, used to pan incrementally. */
  lastX: number;
  lastY: number;
  /** Whether this gesture has crossed `passedDragThreshold` and taken pointer capture. */
  captured: boolean;
}

/**
 * Drag to pan, wheel to zoom, over any element.
 *
 * Lives in `src/lib/` rather than beside the graph because it holds no product
 * knowledge — it is behaviour, like `useFlushTriggers` and `useAnchoredMenu`.
 * That directory may import nothing from `src/app/`, `src/data/`,
 * `src/features/` or `src/i18n/`, and this does not.
 */
export function usePanZoom(initial: Viewport): PanZoom {
  const [viewport, setViewport] = useState<Viewport>(initial);
  const dragging = useRef<Drag | null>(null);

  /**
   * Deliberately does NOT call `setPointerCapture` here. Capturing on every
   * pointerdown — even one that never moves, i.e. a plain click — retargets
   * the browser's own synthesized `click` event to the capturing element
   * (this one) instead of whatever the pointer actually landed on. On the
   * graph, that silently broke every node click: `onSelect` never fired,
   * because the `click` the node's own listener was waiting for arrived at
   * the SVG instead. Confirmed by removing the capture entirely and
   * observing that clicks then reach their real target — see
   * `.superpowers/sdd/2026-08-31-l3-relationship-graph/task-10-report.md`.
   * Capture is deferred to `onPointerMove`, once real movement crosses
   * `passedDragThreshold`, so a click with no movement is never captured
   * and its `click` event is never retargeted.
   */
  const onPointerDown = useCallback((event: PointerEvent<Element>) => {
    if (event.button !== 0) return;
    dragging.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      captured: false,
    };
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<Element>) => {
    const drag = dragging.current;
    if (drag === null || drag.id !== event.pointerId) return;

    if (!drag.captured) {
      const totalDx = event.clientX - drag.startX;
      const totalDy = event.clientY - drag.startY;
      // Not yet a drag: no capture, no pan. Waiting for the next move to
      // cross the threshold (or for `onPointerUp` to end this as a click).
      if (!passedDragThreshold(totalDx, totalDy)) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured = true;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    setViewport((current) => panBy(current, dx, dy));
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<Element>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
    // Safe even when capture was never taken (a plain click): the guard
    // already there before this fix is exactly what makes that safe.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onWheel = useCallback((event: WheelEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.002);
    setViewport((current) =>
      zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top),
    );
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setViewport((current) => zoomAt(current, factor, 0, 0));
  }, []);

  const reset = useCallback(() => setViewport(initial), [initial]);

  return { viewport, onPointerDown, onPointerMove, onPointerUp, onWheel, zoomBy, reset };
}
