import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

import { panBy, type Viewport, zoomAt } from './panZoom';

export interface PanZoom {
  viewport: Viewport;
  onPointerDown: (event: PointerEvent<Element>) => void;
  onPointerMove: (event: PointerEvent<Element>) => void;
  onPointerUp: (event: PointerEvent<Element>) => void;
  onWheel: (event: WheelEvent<Element>) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
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
  const dragging = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: PointerEvent<Element>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<Element>) => {
    const drag = dragging.current;
    if (drag === null || drag.id !== event.pointerId) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragging.current = { id: drag.id, x: event.clientX, y: event.clientY };
    setViewport((current) => panBy(current, dx, dy));
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<Element>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
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
