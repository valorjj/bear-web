import type { ReactElement } from 'react';

import type { NoteScope } from '@/features/notes';
import { useT } from '@/i18n';
import { useOverlayHistory } from '@/lib/useOverlayHistory';
import { Dialog } from '@/ui/Dialog';

import { SidebarContent, type SidebarContentProps } from './SidebarContent';

export interface SidebarDrawerProps extends SidebarContentProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The tag sidebar as an overlay, for every layout narrower than `desktop`.
 *
 * Built on `Dialog` rather than a second overlay of its own: `Dialog` already
 * carries the wide-selector focus trap, Escape, the backdrop, and focus
 * restore to whatever opened it. `docs/rulings/accessibility.md` records why
 * that trap must use the wide selector rather than `'button'` — a trap that
 * skips a focusable does not hold focus at the modal's edge, it lets Tab walk
 * out into the page behind where the user cannot see where focus went, which
 * is worse than no trap at all. A second, narrower trap here would reintroduce
 * exactly that.
 *
 * Its content is `SidebarContent` verbatim, the same component the desktop
 * pane renders. There is no mobile variant of the tag tree to keep in step.
 */
export function SidebarDrawer({ open, onClose, ...content }: SidebarDrawerProps): ReactElement {
  const t = useT();

  // Android's back button and iOS's edge-swipe dismiss the drawer rather than
  // leaving the app — the first thing anyone tries on a phone.
  useOverlayHistory(open, onClose, 'sidebar');

  function chooseScope(next: NoteScope): void {
    content.onScopeChange(next);
    // Closing is the point of choosing: the list the user just filtered is
    // behind this drawer, and leaving it open would hide the result of their
    // own action.
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      label={t('sidebar.drawer')}
      placement="start"
      // `max-w-xs` rather than full width, so the note list stays visible at
      // the right edge — the drawer reads as covering the list rather than
      // replacing it, and the strip of list is a target for dismissing it.
      className="bg-sidebar h-full w-full max-w-xs"
    >
      <SidebarContent {...content} onScopeChange={chooseScope} touch />
    </Dialog>
  );
}
