import type { ReactElement, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'touch';

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
  // A resting fill, for a control on a TOUCH surface. `ghost` is defined as
  // quiet-until-hovered, which on a touch device means quiet forever — there
  // is no pointer to cross it. M9a made the note-list header `ghost` because
  // a bordered row "read as a set of form controls" and dated the app; that
  // reasoning was about a mouse-driven header and does not transfer to a
  // phone, where the alternative is an invisible affordance.
  soft: 'bg-hover text-text hover:bg-selected',
};

/**
 * Radius lives HERE, not in the base class list, so `touch` can be a circle
 * without an overriding utility. Two `rounded-*` utilities in the same layer
 * are resolved by stylesheet order, not by the order the class attribute lists
 * them — the trap `Pane`'s `shadow-none` cost this project a day. A size that
 * omits `rounded-sm` is the only reliable way not to have it.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-ui-sm rounded-sm',
  md: 'h-7 px-2 text-ui rounded-sm',
  // 44x44 — Apple's HIG figure and WCAG 2.5.5 Target Size (Enhanced). NOT
  // 2.5.8, which this comment used to cite: 2.5.8 is the AA criterion and asks
  // for 24. Square and circular, because at this size it holds one glyph and
  // nothing else.
  touch: 'h-11 w-11 rounded-full',
};

/*
 * Which sizes need J2's hit-area treatment.
 *
 * `touch` is already 44 x 44 and needs nothing. `sm` (24px) and `md` (28px)
 * are below a fingertip, so on a coarse pointer they get a 44px `::after`
 * while the drawn button keeps its size — see `touch-target` in
 * `src/styles/index.css`. Growing the button itself would reflow every
 * header, menu and toolbar it appears in, which is J3's work, not J2's.
 */
const NEEDS_TOUCH_TARGET: Record<ButtonSize, string> = {
  sm: 'touch-target',
  md: 'touch-target',
  touch: '',
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
      className={`inline-flex shrink-0 items-center justify-center transition-colors duration-[var(--bear-duration-fast)] ease-bear disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${NEEDS_TOUCH_TARGET[size]} ${className}`}
    >
      {children}
    </button>
  );
}
