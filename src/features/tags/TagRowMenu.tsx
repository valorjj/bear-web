import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';
import { Icon, type LucideIcon, SquarePen, Trash2 } from '@/ui/Icon';

/** What the menu was opened on, and where. */
export interface TagRowMenuRequest {
  tag: string;
  /**
   * Viewport rectangle to anchor against: a zero-size rect at the pointer for
   * a right-click or long press, the row's own rect for the `Shift+F10`
   * keyboard route. Same shape, and the same reason, as
   * `NoteRowMenuRequest.rect`.
   */
  rect: DOMRect;
}

export type TagRowAction = 'rename' | 'delete';

export interface TagRowMenuProps {
  request: TagRowMenuRequest;
  onAction: (action: TagRowAction) => void;
  onClose: () => void;
}

/**
 * Module scope, never inside the render body. A component defined in a render
 * body is a new type every render, so React unmounts and remounts every item —
 * which throws keyboard focus out of the menu. `NoteRowMenu`'s `Item` was
 * written the wrong way first; this is the same fix.
 */
function Item({
  glyph,
  label,
  onSelect,
  danger = false,
}: {
  glyph: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`hover:bg-hover ease-bear flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ${
        danger ? 'text-danger' : 'text-text'
      }`}
    >
      <span className="text-faint">
        <Icon glyph={glyph} size="sm" />
      </span>
      {label}
    </button>
  );
}

/**
 * A tag row's right-click menu.
 *
 * Placement, focus, dismissal and the Tab trap all come from
 * `useAnchoredMenu`; this file is the item list and nothing else — the same
 * division `NoteRowMenu` follows.
 */
export function TagRowMenu({ request, onAction, onClose }: TagRowMenuProps): ReactElement {
  const t = useT();
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose);

  function act(action: TagRowAction): void {
    onAction(action);
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('tags.menu.label')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        // `dvh`, not `vh`: on mobile `100vh` ignores the browser's collapsing
        // chrome, so a menu clamped against it can still run off-screen.
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      className="bg-surface border-border shadow-popover fixed z-20 min-w-48 overflow-y-auto rounded-md border p-1"
    >
      <Item glyph={SquarePen} label={t('tags.menu.rename')} onSelect={() => act('rename')} />
      <Item glyph={Trash2} label={t('tags.menu.delete')} onSelect={() => act('delete')} danger />
    </div>
  );
}
