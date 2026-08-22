import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export interface AdoptNotesDialogProps {
  open: boolean;
  count: number;
  onAdopt: () => void;
  onDiscard: () => void;
}

/**
 * Fires once, the first time a device signs into an account whose local
 * notes it has never synced — either a genuinely new sign-in, or an account
 * switch on a device that still holds a previous account's notes.
 *
 * Built on `ConfirmDialog` rather than as a sibling component: its two
 * buttons carry these two meanings without the "cancel" position becoming
 * the destructive one. "Add them" — the safe, non-destructive choice — sits
 * in `ConfirmDialog`'s cancel slot, so it is the button focused on open and
 * the one Escape (and a backdrop click) invokes. "Discard them" is the one
 * button styled destructive. This is deliberate, not a naming accident:
 * dismissing a dialog must never be the branch that deletes someone's notes.
 *
 * The note count is composed here, not inside a translated string —
 * `useT()` takes no arguments and this app has no interpolation mechanism.
 * `sync.adopt.bodyBefore` and `sync.adopt.bodyAfter` are plain string halves;
 * each carries its own surrounding whitespace so the seam around the number
 * reads naturally in its own language (see `ko.ts`, where the count is
 * followed directly by a counter word with no space).
 */
export function AdoptNotesDialog({
  open,
  count,
  onAdopt,
  onDiscard,
}: AdoptNotesDialogProps): ReactElement | null {
  const t = useT();

  return (
    <ConfirmDialog
      open={open}
      title={t('sync.adopt.title')}
      body={`${t('sync.adopt.bodyBefore')}${count}${t('sync.adopt.bodyAfter')}`}
      cancelLabel={t('sync.adopt.confirm')}
      confirmLabel={t('sync.adopt.discard')}
      onCancel={onAdopt}
      onConfirm={onDiscard}
      destructive
    />
  );
}
