import { type ReactElement, useId } from 'react';

import { Button } from './Button';
import { Dialog } from './Dialog';

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
 * the dialog opens must not destroy anything. `Dialog` focuses the first
 * focusable in DOM order, and Cancel is first — see the comment on the button
 * row below, which is load-bearing rather than stylistic.
 *
 * The backdrop, the trap, Escape and focus restoration all come from
 * `Dialog`. Extracting them fixed a gap this component documented and lived
 * with: its own trap queried `'button'`, so a link or input inside it would
 * have been skipped rather than held at the modal's edge.
 *
 * `alertdialog` rather than `dialog` is not decoration — it is the role for a
 * confirmation guarding a destructive action, and this app's confirmations
 * guard note deletion.
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

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      className="w-full max-w-sm gap-4 p-6"
    >
      <h2 id={titleId} className="text-ui-lg text-text font-semibold">
        {title}
      </h2>
      <p id={bodyId} className="text-ui text-muted">
        {body}
      </p>

      {/*
        Cancel comes FIRST in DOM order, deliberately. It is what `Dialog`'s
        mount effect focuses, and what the Tab-wrap arithmetic treats as
        `first`. Reordering these two swaps which button an in-flight Enter
        press activates, on a dialog guarding irreversible deletion.
      */}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button onClick={onConfirm} variant={destructive ? 'danger' : 'primary'}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
