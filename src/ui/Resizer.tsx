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
        const next = clamp(width + delta);
        // Move the pane immediately rather than waiting on the commit's async
        // write + live query round trip (Finding 6) — the same optimistic
        // value AppShell then holds onto until the write is confirmed
        // (Finding 3).
        onResize(next);
        onCommit(next);
      }}
      // The visible divider stays a hairline (the centred inner span below),
      // but the interactive box is widened to roughly 8px using a negative
      // margin that cancels back out in flex layout, so neighbouring panes
      // never shift (Finding 4). `relative z-10` keeps this element painted
      // above the flow-adjacent panes so the overlap is actually hit-testable
      // on both sides, not just whichever pane happens to come first in the
      // DOM.
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[background-color,width] duration-[var(--bear-duration-fast)] ease-bear group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent"
      />
    </div>
  );
}
