import type { ReactElement, ReactNode } from 'react';

export interface PaneProps {
  label: string;
  /** Fixed pixel width. Omit to let the pane fill the remaining space. */
  width?: number;
  /**
   * Whether the pane reads as a card floating above the canvas.
   *
   * A prop rather than a `shadow-none` the caller appends to `className`: two
   * utilities in the same layer are resolved by STYLESHEET order, not by the
   * order they appear in the class attribute, so appending `shadow-none` to a
   * base `shadow-popover` silently did nothing. Omitting the class is the only
   * reliable way to not have it.
   */
  elevated?: boolean;
  children: ReactNode;
  className?: string;
}

export function Pane({
  label,
  width,
  elevated = true,
  children,
  className = '',
}: PaneProps): ReactElement {
  return (
    <section
      aria-label={label}
      style={width === undefined ? undefined : { width: `${width}px` }}
      className={`h-full min-w-0 overflow-y-auto rounded-lg ${elevated ? 'shadow-popover' : ''} ${width === undefined ? 'flex-1' : 'shrink-0'} ${className}`}
    >
      {children}
    </section>
  );
}
