import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

/**
 * Every focusable kind, not just `'button'`.
 *
 * `ConfirmDialog` queried `'button'` for the whole of its life, and its own
 * comments called that a documented gap — harmless only because it holds
 * exactly two buttons. A trap that skips a focusable does not hold it at the
 * modal's edge; it lets Tab walk out into the page behind, which is strictly
 * worse than no trap because the user cannot see where focus went. Copied
 * from `Popover`, which already made this choice for the same reason.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  /** Escape, a backdrop click, or the caller's own close control. */
  onClose: () => void;
  children: ReactNode;
  /**
   * `alertdialog` for a confirmation guarding a destructive action; that is a
   * real distinction and not decoration, so it is a deliberate choice rather
   * than a default.
   */
  role?: 'dialog' | 'alertdialog';
  /** Accessible name, already translated. Use this OR `labelledBy`. */
  label?: string;
  /** Id of an element inside the dialog that names it. */
  labelledBy?: string;
  /** Id of an element inside the dialog that describes it. */
  describedBy?: string;
  /**
   * `center` is a modal box; `start` is a drawer anchored to the inline start
   * edge, full height.
   *
   * A prop that OMITS classes, never a caller appending overriding ones: the
   * centring lives on the backdrop wrapper rather than the panel, and even the
   * panel's own `mx-4`/`rounded-lg` are utilities in the same layer as anything
   * appended — which the stylesheet's order decides, not the class attribute's.
   * `Pane`'s `shadow-none` cost this project a day proving that.
   */
  placement?: 'center' | 'start';
  /** Panel classes, so a caller controls its own width and padding. */
  className?: string;
}

const PLACEMENT = {
  center: { wrapper: 'items-center justify-center', panel: 'mx-4 rounded-lg' },
  start: { wrapper: 'items-stretch justify-start', panel: 'rounded-none' },
} as const;

/**
 * A modal surface: backdrop, focus trap, Escape to close, focus restored to
 * whatever opened it.
 *
 * Presentation only — it knows nothing about themes, notes or scopes, which
 * is what lets it live in `src/ui/`. Every string arrives translated.
 *
 * The trap cycles on keydown rather than using `inert`, which jsdom does not
 * implement. That is enough to test tab order and Escape here; behaviour
 * depending on real focus semantics across the backdrop belongs in Playwright.
 */
export function Dialog({
  open,
  onClose,
  children,
  role = 'dialog',
  label,
  labelledBy,
  describedBy,
  placement = 'center',
  className = '',
}: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    // Captured before focus moves inside, and restored on close. Without it
    // the opener — an icon-only trigger, in every current caller — is lost
    // and Tab resumes from the top of the document.
    openerRef.current = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable === undefined || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Wrapping in both directions is what makes this a trap rather than a
      // suggestion: without it, Tab walks out into the page behind the modal.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex ${PLACEMENT[placement].wrapper}`}>
      {/*
        The backdrop closes on click. It carries no accessible role: the panel
        is `aria-modal`, so assistive tech already treats everything outside it
        as inert, and a second interactive element announcing itself would be
        noise.
      */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="ease-bear bg-text absolute inset-0 opacity-20 transition-opacity duration-[var(--bear-duration)]"
      />

      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`bg-bg shadow-dialog relative z-10 flex flex-col ${PLACEMENT[placement].panel} ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
