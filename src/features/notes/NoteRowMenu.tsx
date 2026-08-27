import type { ReactElement, ReactNode } from 'react';

import { useSessionValue } from '@/features/account';
import { type ExportFormat, useExportProgress } from '@/features/export';
import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';
import {
  ClipboardCopy,
  Copy,
  Download,
  FileCode,
  FileText,
  Icon,
  LoaderCircle,
  type LucideIcon,
  Pin,
  RotateCcw,
  Trash2,
} from '@/ui/Icon';

/** What the menu was opened on, and where. */
export interface NoteRowMenuRequest {
  noteId: string;
  pinned: boolean;
  /**
   * Whether the row is in the trash. The two destructive routes are mutually
   * exclusive — a trashed note offers Restore and Delete forever, an active
   * one offers Delete — so this decides which of them the menu draws rather
   * than greying out the other.
   */
  trashed: boolean;
  /**
   * Viewport rectangle to anchor against: a zero-size rect at the pointer for
   * a right-click, the row's own rect for the `Shift+F10` keyboard route.
   * Same shape, and the same reason, as `ContextMenuRequest.rect`.
   */
  rect: DOMRect;
}

export type NoteRowAction = 'pin' | 'duplicate' | 'copyText' | 'trash' | 'restore' | 'purge';

export interface NoteRowMenuProps {
  request: NoteRowMenuRequest;
  onAction: (action: NoteRowAction) => void;
  onExport: (format: ExportFormat) => void;
  onClose: () => void;
}

interface ExportChoice {
  format: ExportFormat;
  label: 'export.markdown' | 'export.html' | 'export.pdf';
  glyph: LucideIcon;
  /** PDF renders server-side and needs the signed-in session to reach it. */
  requiresSession?: true;
}

const EXPORT_CHOICES: readonly ExportChoice[] = [
  { format: 'md', label: 'export.markdown', glyph: Download },
  { format: 'html', label: 'export.html', glyph: FileCode },
  { format: 'pdf', label: 'export.pdf', glyph: FileText, requiresSession: true },
];

function Separator(): ReactElement {
  return <div role="separator" className="border-border my-1 border-t" />;
}

function GroupLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="text-faint px-2 pt-1 pb-0.5 text-xs">{children}</div>;
}

/**
 * Declared at module scope, not inside `NoteRowMenu`. A component defined in a
 * render body is a NEW type on every render, so React unmounts and remounts
 * every row — and this menu re-renders while it is open (the PDF item's
 * `pending` flag flips mid-export), which would throw keyboard focus out of
 * the menu at exactly the moment the user is reading it.
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
        // Only the WORD takes the danger colour; the fill stays quiet. Matches
        // "Move to trash" in the note-list header and the delete rows in
        // `EditorContextMenu` — see `docs/rulings/accessibility.md`.
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
 * A note row's right-click menu.
 *
 * Placement, focus, dismissal and the Tab trap all come from
 * `useAnchoredMenu`; this file is the item list and nothing else.
 *
 * The export destinations are a flat labelled GROUP, not a submenu. Bear's own
 * menu nests them, but a submenu needs its own open/close state, its own
 * hover-intent delay and its own arrow-key contract — three rows do not earn
 * that, and `ExportMenu` (which this group mirrors, down to the PDF item's
 * sign-in gate) already proves a flat list reads fine.
 *
 * Every item is a plain `role="menuitem"`: each one acts once and closes. Pin
 * is deliberately NOT a `menuitemcheckbox` — the row it acts on shows the pin
 * state already, and the item's own words flip between Pin and Unpin, so a
 * checked state would describe the note twice and disagree with the verb.
 */
export function NoteRowMenu({
  request,
  onAction,
  onExport,
  onClose,
}: NoteRowMenuProps): ReactElement {
  const t = useT();
  const { state } = useSessionValue();
  const { pending } = useExportProgress();
  // `request.trashed` re-measures: the trash variant draws two destructive
  // rows where the active one draws a single row, so the menu's height
  // changes with it and a stale position would hang off the viewport's edge.
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose, [
    request.trashed,
  ]);

  function act(action: NoteRowAction): void {
    onAction(action);
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('note.menu.label')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        // `dvh`, not `vh`. On mobile `100vh` is the LARGE viewport: it
        // ignores the browser's own collapsing chrome, so a tall menu clamped
        // against it can still run past the bottom of the screen. `dvh` is
        // the viewport as it actually is right now.
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      className="bg-surface border-border shadow-popover fixed z-20 min-w-48 overflow-y-auto rounded-md border p-1"
    >
      <Item
        glyph={Pin}
        label={request.pinned ? t('note.unpin') : t('note.pin')}
        onSelect={() => act('pin')}
      />
      <Item glyph={Copy} label={t('note.duplicate')} onSelect={() => act('duplicate')} />
      <Item glyph={ClipboardCopy} label={t('note.copyText')} onSelect={() => act('copyText')} />

      <Separator />
      <GroupLabel>{t('export.label')}</GroupLabel>
      {EXPORT_CHOICES.map((choice) => {
        const busy = choice.format === 'pdf' && pending;
        // `aria-disabled`, not the HTML attribute: an HTML-disabled button
        // leaves the tab order, so a keyboard user could never reach it to
        // discover why PDF is off. The `sr-only` span carries the reason into
        // the accessible name; `onClick` refuses the action itself. See
        // `docs/rulings/accessibility.md` — and note that Playwright then
        // refuses to click the item at all, so its e2e coverage must drive it
        // by keyboard.
        const disabled = (choice.requiresSession === true && state.status !== 'signedIn') || busy;

        return (
          <button
            key={choice.format}
            type="button"
            role="menuitem"
            aria-disabled={disabled ? 'true' : undefined}
            aria-busy={busy ? 'true' : undefined}
            onClick={() => {
              if (disabled) return;
              onExport(choice.format);
              onClose();
            }}
            className={`ease-bear flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ${
              disabled ? 'text-faint' : 'hover:bg-hover text-text'
            }`}
          >
            <span className="text-faint">
              <Icon
                glyph={busy ? LoaderCircle : choice.glyph}
                size="sm"
                className={busy ? 'bear-spin' : ''}
              />
            </span>
            {t(choice.label)}
            {disabled && (
              // The leading space is load-bearing: accessible-name computation
              // concatenates text content and ignores the CSS gap, so without
              // it this announces as "PDFSign in to export PDF".
              <span className="sr-only">
                {' '}
                {busy ? t('export.pdf.pending') : t('export.pdf.requiresSignIn')}
              </span>
            )}
          </button>
        );
      })}

      <Separator />
      {request.trashed ? (
        <>
          <Item glyph={RotateCcw} label={t('noteList.restore')} onSelect={() => act('restore')} />
          <Item
            glyph={Trash2}
            label={t('noteList.deleteForever')}
            danger
            onSelect={() => act('purge')}
          />
        </>
      ) : (
        <Item glyph={Trash2} label={t('noteList.trash')} danger onSelect={() => act('trash')} />
      )}
    </div>
  );
}
