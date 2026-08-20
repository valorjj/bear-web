import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A standard focusable selector, deliberately wider than `ConfirmDialog`'s
 * `'button'`.
 *
 * That narrowness is a documented gap there — harmless while the dialog holds
 * exactly two buttons — and would be a live defect here, because this surface
 * holds grouped rows and headings and is meant to grow. A focusable this
 * selector missed would be skipped by the trap rather than held at its edge.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A non-modal anchored surface. Presentation only: it knows nothing about
 * themes, scopes or notes, which is what lets it live in `src/ui/`.
 *
 * Positioning is the caller's job, supplied through `className`. Two callers
 * with different anchors would otherwise each need an escape hatch out of a
 * layout this component chose for them.
 */
export function Popover({
  open,
  onClose,
  label,
  children,
  className = '',
}: PopoverProps): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        // Stopped so an Escape aimed at this surface cannot also reach a
        // handler behind it and dismiss two things with one keypress.
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`border-border bg-surface shadow-popover rounded-lg border p-1 ${className}`}
    >
      {children}
    </div>
  );
}
