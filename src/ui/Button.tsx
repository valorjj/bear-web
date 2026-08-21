import type { ReactElement, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  onClick: () => void;
  children: ReactNode;
  /** Accessible name, for when `children` is an icon rather than text. */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  /**
   * Menu-trigger wiring, declared explicitly rather than by spreading arbitrary
   * props. A button that opens a menu has to say so, and these two are the only
   * ARIA attributes a presentation primitive can own without knowing what the
   * menu contains — everything else belongs to the caller's surface.
   */
  ariaHasPopup?: 'menu';
  ariaExpanded?: boolean;
}

/*
 * `text-bg` is the on-accent foreground in both directions, which is not a
 * coincidence worth losing: Paper's `bg` is white against a mid red, and Ink's
 * `bg` is near-black against a light coral. A literal white would fail in Ink.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  // A hairline and a surface, so a button reads as a control at rest rather
  // than as a label. Until M6 this was `text-text hover:bg-hover` — no border,
  // no fill — which made "New note", "Delete" and "Restore" indistinguishable
  // from static text until the pointer happened to cross them. `ghost` is the
  // variant for a control that should stay quiet until hovered; `default` is
  // not, because it carries the primary action of the note list.
  default: 'border border-border bg-bg text-text hover:bg-hover',
  primary: 'bg-accent text-bg hover:opacity-90',
  danger: 'bg-danger text-bg hover:opacity-90',
  ghost: 'text-muted hover:bg-hover hover:text-text',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-ui-sm',
  md: 'h-7 px-2 text-ui',
};

export function Button({
  onClick,
  children,
  label,
  variant = 'default',
  size = 'md',
  disabled = false,
  className = '',
  ariaHasPopup,
  ariaExpanded,
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--bear-duration-fast)] ease-bear disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
