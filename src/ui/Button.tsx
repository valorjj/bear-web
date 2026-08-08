import type { ReactElement, ReactNode } from 'react';

export interface ButtonProps {
  onClick: () => void;
  children: ReactNode;
  /** Accessible name, for when `children` is an icon rather than text. */
  label?: string;
  className?: string;
}

export function Button({ onClick, children, label, className = '' }: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm text-text hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      {children}
    </button>
  );
}
