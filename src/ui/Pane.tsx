import type { ReactElement, ReactNode } from 'react';

export interface PaneProps {
  label: string;
  /** Fixed pixel width. Omit to let the pane fill the remaining space. */
  width?: number;
  children: ReactNode;
  className?: string;
}

export function Pane({ label, width, children, className = '' }: PaneProps): ReactElement {
  return (
    <section
      aria-label={label}
      style={width === undefined ? undefined : { width: `${width}px` }}
      className={`h-full min-w-0 overflow-y-auto rounded-lg shadow-popover ${width === undefined ? 'flex-1' : 'shrink-0'} ${className}`}
    >
      {children}
    </section>
  );
}
