import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { useAnchoredMenu } from '@/lib/useAnchoredMenu';

import type { TableHandleAction, TableHandleMenuRequest } from './TableHandles';

export interface TableHandleMenuProps {
  request: TableHandleMenuRequest;
  onAction: (action: TableHandleAction) => void;
  onClose: () => void;
}

/**
 * The menu a row or column handle opens.
 *
 * Rendered by the app, never by the plugin — the same boundary `HeadingMenu`
 * and `TagPill`'s `onActivate` both keep: the plugin reports which handle was
 * clicked (`TableHandleMenuRequest`), and React draws the menu and turns a
 * choice into `editor.commands.runTableHandleAction`.
 *
 * Deletion moved into the right-click context menu in sub-project H, alongside
 * edge handles that only ever inserted. That left `Delete row`/`Delete
 * column` with no discoverable route at all — right-click has no affordance
 * anywhere in this app, so a user staring at a table full of `+` handles had
 * no way to find it. This menu is the fix: the SAME handle that used to insert
 * directly now offers both directions of insert AND delete, scoped to the row
 * or column it sits on. See `docs/rulings/tables.md`'s amended entry.
 *
 * `Insert … before`/`Insert … after` reuse the context menu's own labels
 * (`editor.table.addRowBefore` etc.) rather than new strings — same action,
 * same words, a different door to it. `Delete row`/`Delete column` do the
 * same. Destructive words, not a glyph: `docs/rulings/tables.md` and
 * `docs/rulings/accessibility.md` both hold that an icon-only delete asks the
 * user to recall a glyph before destroying data, which is exactly why this
 * menu route was chosen over a bare `−` button on the handle itself.
 */
export function TableHandleMenu({
  request,
  onAction,
  onClose,
}: TableHandleMenuProps): ReactElement {
  const t = useT();

  const isRow = request.kind === 'row';
  const label = t(isRow ? 'editor.table.rowHandle' : 'editor.table.columnHandle');
  const beforeLabelKey = isRow ? 'editor.table.addRowBefore' : 'editor.table.addColumnBefore';
  const afterLabelKey = isRow ? 'editor.table.addRowAfter' : 'editor.table.addColumnAfter';
  const deleteLabelKey = isRow ? 'editor.table.deleteRow' : 'editor.table.deleteColumn';
  const beforeAction: TableHandleAction = isRow ? 'addRowBefore' : 'addColumnBefore';
  const afterAction: TableHandleAction = isRow ? 'addRowAfter' : 'addColumnAfter';
  const deleteAction: TableHandleAction = isRow ? 'deleteRow' : 'deleteColumn';

  // Placement, initial focus, Escape/outside dismissal and the Tab trap all
  // come from `useAnchoredMenu`, which is where the reasoning behind each now
  // lives — including why the outside-click listener must be a CAPTURE
  // listener, which matters here because `TableHandles`' own mousedown handler
  // runs during the bubble phase.
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
      className="bg-surface border-border shadow-popover fixed z-20 min-w-48 rounded-md border p-1"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAction(beforeAction);
          onClose();
        }}
        className="text-ui-sm text-text hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t(beforeLabelKey)}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAction(afterAction);
          onClose();
        }}
        className="text-ui-sm text-text hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t(afterLabelKey)}
      </button>

      <div className="bg-border my-1 h-px" role="separator" />

      <button
        type="button"
        role="menuitem"
        data-destructive=""
        onClick={() => {
          onAction(deleteAction);
          onClose();
        }}
        className="text-ui-sm text-danger hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t(deleteLabelKey)}
      </button>
    </div>
  );
}
