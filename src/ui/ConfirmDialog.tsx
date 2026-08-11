import { type ReactElement, useEffect, useId, useRef } from 'react';

import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Renders the confirm action as destructive. */
  destructive?: boolean;
}

/**
 * A modal confirmation, for actions with no undo.
 *
 * Presentation only: every string arrives translated, so this file imports
 * nothing from `@/i18n` and the `src/ui` boundary holds.
 *
 * **Focus starts on Cancel, deliberately.** These dialogs guard irreversible
 * deletion with no server copy, and an Enter keypress already in flight when
 * the dialog opens must not destroy anything.
 *
 * The focus trap cycles on keydown rather than using `inert`, which jsdom does
 * not implement. That is enough to test tab order and Escape here; behaviour
 * that depends on real focus semantics across the backdrop belongs in
 * Playwright, alongside the pointer-drag tests that are there for the same
 * reason.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps): ReactElement | null {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The cancel button is the first `button` in DOM order, which is also what
    // makes the Tab-wrap arithmetic below correct. Queried through `dialogRef`
    // rather than held in its own ref because `Button` does not forward refs,
    // and widening its API for this is more than this task needs.
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
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
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/*
        The backdrop cancels on click. It carries no accessible role: the
        dialog below is `aria-modal`, so assistive tech already treats
        everything outside it as inert, and a second interactive element
        announcing itself would be noise.
      */}
      <div
        aria-hidden="true"
        onClick={onCancel}
        className="absolute inset-0 bg-text opacity-20 transition-opacity duration-[var(--bear-duration)] ease-bear"
      />

      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative z-10 mx-4 flex w-full max-w-sm flex-col gap-4 rounded-lg bg-bg p-5 shadow-dialog"
      >
        <h2 id={titleId} className="text-ui-lg font-semibold text-text">
          {title}
        </h2>
        <p id={bodyId} className="text-ui text-muted">
          {body}
        </p>

        {/*
          Cancel comes FIRST in DOM order, deliberately. It is what the mount
          effect focuses, and what the Tab-wrap arithmetic treats as `first`.
          Reordering these two swaps which button an in-flight Enter press
          activates, on a dialog guarding irreversible deletion.
        */}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button onClick={onConfirm} variant={destructive ? 'danger' : 'primary'}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
