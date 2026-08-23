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
  /** Panel classes, so a caller controls its own width and padding. */
  className?: string;
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
        className={`bg-bg shadow-dialog relative z-10 mx-4 flex flex-col rounded-lg ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
