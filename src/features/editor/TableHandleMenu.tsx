import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';

import type { TableHandleAction, TableHandleMenuRequest } from './TableHandles';

/**
 * Everything focusable, NOT `'button'` — copied verbatim from `HeadingMenu`.
 * See that file's docblock: `ConfirmDialog`'s `'button'`-only trap is a
 * documented gap, harmless there only because it holds exactly two buttons;
 * copying it here would silently skip any future non-button item, leaving it
 * invisible to both the initial-focus effect and the Tab-wrap arithmetic.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  const ref = useRef<HTMLDivElement | null>(null);

  const isRow = request.kind === 'row';
  const label = t(isRow ? 'editor.table.rowHandle' : 'editor.table.columnHandle');
  const beforeLabelKey = isRow ? 'editor.table.addRowBefore' : 'editor.table.addColumnBefore';
  const afterLabelKey = isRow ? 'editor.table.addRowAfter' : 'editor.table.addColumnAfter';
  const deleteLabelKey = isRow ? 'editor.table.deleteRow' : 'editor.table.deleteColumn';
  const beforeAction: TableHandleAction = isRow ? 'addRowBefore' : 'addColumnBefore';
  const afterAction: TableHandleAction = isRow ? 'addRowAfter' : 'addColumnAfter';
  const deleteAction: TableHandleAction = isRow ? 'deleteRow' : 'deleteColumn';

  // Anchored below the handle until proven otherwise — same two-stage
  // approach `HeadingMenu` uses and for the same reason: `request.rect` is
  // the only geometry known before mount.
  const [position, setPosition] = useState(() => ({
    top: request.rect.bottom + 4,
    left: request.rect.left,
  }));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  // Flips above the handle when there is no room below, and clamps
  // horizontally into the viewport — copied verbatim from `HeadingMenu`'s own
  // flip/clamp effect. A row near the bottom of a long table is exactly where
  // this menu gets used, so opening off-screen is the common case here too.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const menuRect = el.getBoundingClientRect();

    const fitsBelow = request.rect.bottom + 4 + menuRect.height <= window.innerHeight;
    const top = fitsBelow
      ? request.rect.bottom + 4
      : Math.max(4, request.rect.top - 4 - menuRect.height);

    const left = Math.min(request.rect.left, window.innerWidth - menuRect.width - 4);

    setPosition({ top, left: Math.max(4, left) });
  }, [request]);

  // Neither listener can live on the menu's own React `onKeyDown`/`onClick`:
  // both must keep working after focus (or the click itself) has already left
  // this subtree. Copied verbatim from `HeadingMenu`.
  useEffect(() => {
    function handleOutsideMouseDown(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    // Capture, not bubble — same reason `HeadingMenu` gives: a click on
    // another handle is itself what opens (or re-opens) a menu, and
    // `TableHandles`' own mousedown handler runs during the BUBBLE phase.
    document.addEventListener('mousedown', handleOutsideMouseDown, true);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [onClose]);

  // Tab-trapping only — Escape is handled at the document level above so it
  // keeps working once focus has left this subtree.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') return;

    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? index - 1 : index + 1;
    if (next < 0 || next >= items.length) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }

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
