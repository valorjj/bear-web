import { type PointerEvent as ReactPointerEvent, type ReactElement, useRef } from 'react';

const KEYBOARD_STEP = 10;

export interface ResizerProps {
  label: string;
  width: number;
  min: number;
  max: number;
  /** Fires continuously during a drag. Keep this cheap — do not persist here. */
  onResize: (width: number) => void;
  /** Fires once when a drag or keypress settles. Persist here. */
  onCommit: (width: number) => void;
}

export function Resizer({
  label,
  width,
  min,
  max,
  onResize,
  onCommit,
}: ResizerProps): ReactElement {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(clamp(drag.current.startWidth + (event.clientX - drag.current.startX)));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = clamp(drag.current.startWidth + (event.clientX - drag.current.startX));
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
        onCommit(clamp(width + delta));
      }}
      className="w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    />
  );
}
