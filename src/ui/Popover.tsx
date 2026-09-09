import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
  children: ReactNode;
  className?: string;
  /**
   * Computed placement, for a caller that cannot express its position in
   * classes alone.
   *
   * `AccountMenu` needs this: it lives in the sidebar footer, and the sidebar
   * `Pane` carries `overflow-hidden` so the tag tree scrolls under a pinned
   * footer. An absolutely-positioned surface wider than the pane is therefore
   * CLIPPED by it, not merely overlapping. Escaping that means `position:
   * fixed` with viewport coordinates, which cannot be a static class.
   */
  style?: CSSProperties;
  /**
   * The control that opens this surface, so an outside-pointerdown on it is
   * ignored.
   *
   * Without it the trigger is "outside" like anything else: its pointerdown
   * closes the surface and its own click then reopens it, so the menu appears
   * frozen open and the user's click reads as ignored. Optional, because a
   * popover opened some other way has no trigger to exempt.
   */
  triggerRef?: RefObject<HTMLElement | null>;
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
  style,
  triggerRef,
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

  /**
   * Dismissal by pointing somewhere else.
   *
   * `pointerdown` rather than `click`, for two reasons. A drag that STARTS
   * inside the surface and releases outside it fires a `click` whose target
   * is outside — closing a menu the user was interacting with — and
   * `pointerdown` is judged where the gesture began. It also fires before
   * focus moves, so the surface closes without a frame of the trap fighting
   * the browser over where focus should land.
   *
   * The trigger is exempt: it is outside this element, so without the check
   * its pointerdown closes the surface and its own click immediately reopens
   * it. See `triggerRef`.
   *
   * Capture phase, so a child that stops propagation cannot silently disable
   * dismissal for the whole surface.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (target === null) return;
      if (ref.current?.contains(target) === true) return;
      if (triggerRef?.current?.contains(target) === true) return;
      onClose();
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      // `bear-app-palette`: a floating panel paints in the APP palette, wherever
      // it is mounted. Without it, a popover opened from the SIDEBAR inherits
      // that container's re-mapped tokens — the light indigo themes and every
      // other light theme paint a dark sidebar and re-map `text`, `muted`,
      // `faint`, `border`, `hover`, `selected` and `scrollbar` on it — so its
      // borders and secondary text would resolve light-on-light. See
      // `tokens.css`.
      className={`bear-app-palette border-border bg-surface shadow-popover rounded-lg border p-1 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
