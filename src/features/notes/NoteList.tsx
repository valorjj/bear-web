import { type ReactElement, type RefObject, useCallback, useState } from 'react';

import type { Note, NoteOrder } from '@/data';
import { useExportRunner } from '@/features/export';
import type { LayoutMode } from '@/lib/useLayoutMode';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ChevronDown, Icon, Menu, Plus, SquarePen } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { deriveTitle } from '@/data';

import { NoteListItem } from './NoteListItem';
import { NoteRowMenu, type NoteRowAction, type NoteRowMenuRequest } from './NoteRowMenu';
import type { PreviewSize } from './preview';
import { hasQuery } from './search';
import { SearchField } from './SearchField';
import { allowsTrash, isTrash, type NoteScope, type ScopeQuery, type SmartListId } from './scope';
import { ScopeMenu } from './ScopeMenu';

/**
 * Locked gets its own copy deliberately. "No notes" would tell a user their
 * locked notes are missing; the truth is the feature does not exist yet.
 */
function isLocked(scope: NoteScope): boolean {
  return scope.kind === 'smart' && scope.list === 'locked';
}

function emptyTitle(scope: NoteScope): TranslationKey {
  if (isLocked(scope)) return 'locked.empty.title';
  return isTrash(scope) ? 'trash.empty.title' : 'noteList.empty.title';
}

function emptyBody(scope: NoteScope): TranslationKey {
  if (isLocked(scope)) return 'locked.empty.body';
  return isTrash(scope) ? 'trash.empty.body' : 'noteList.empty.body';
}

const SMART_LIST_LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};

export interface NoteListProps {
  scope: NoteScope;
  /** `undefined` while the live query has not yet resolved. */
  items: Note[] | undefined;
  selectedNoteId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onPurge: (id: string) => void;
  /** Copies a note. The caller decides whether the copy becomes the selection. */
  onDuplicate: (id: string) => void;
  onEmptyTrash: () => void;
  /**
   * Whether "Empty trash" should be disabled. Computed by the caller from the
   * UNFILTERED note list, never from `items` here: `items` is the
   * query-narrowed view, and a query that matches nothing in a full trash
   * must not disable the button that empties the whole trash regardless of
   * the query.
   */
  emptyTrashDisabled: boolean;
  /**
   * Whether the scope had any notes at all before the query narrowed it.
   * Computed by the caller from the UNFILTERED note list, for the same
   * reason as `emptyTrashDisabled`: `items` here is the query-narrowed view,
   * and an empty `items` can mean either "the query matched nothing" or "the
   * scope itself has nothing in it" — those need different copy. Locked is
   * always empty by construction and Trash can genuinely be empty; without
   * this, a query that narrows either to zero rows overwrites their
   * deliberately-special empty copy ("locked notes are missing" / "Trash is
   * empty") with the generic no-results copy, which is a false statement in
   * both cases once the query is cleared.
   */
  hasUnfilteredItems: boolean;
  /**
   * Optional so component tests that do not exercise search can omit them.
   * `AppShell` always supplies both. Defaults are deliberately plain: an
   * empty string and a no-op, never a value that would silently mask a
   * missing wire-up.
   */
  query?: string;
  onQueryChange?: (next: string) => void;
  /** So `AppShell` can focus the field from a keyboard shortcut. */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  /**
   * Rows in this scope BEFORE the query narrowed it, for the header's count.
   * Same reason as `emptyTrashDisabled` and `hasUnfilteredItems`: `items` is
   * the narrowed view, and a search matching one note must not relabel a
   * 33-note list as "1 note".
   */
  count: number;
  /**
   * Named `scopeQuery`, never `query`: `query` above is the SEARCH string, and
   * the two collided the first time this prop was added.
   */
  scopeQuery: ScopeQuery;
  previewSize: PreviewSize;
  onOrderChange: (next: NoteOrder) => void;
  onPreviewSizeChange: (next: PreviewSize) => void;
  onIncludeDescendantsChange: (next: boolean) => void;
  onScopeChange: (next: NoteScope) => void;
  /** Which shell layout is in effect. Decides the header's shape and the FAB. */
  mode: LayoutMode;
  /** Opens the tag drawer. Only reachable below desktop, where no sidebar pane exists. */
  onOpenDrawer: () => void;
}

export function NoteList({
  scope,
  items,
  selectedNoteId,
  onSelect,
  onCreate,
  onTrash,
  onRestore,
  onTogglePin,
  onPurge,
  onDuplicate,
  onEmptyTrash,
  emptyTrashDisabled,
  hasUnfilteredItems,
  query = '',
  onQueryChange = () => {},
  searchInputRef,
  count,
  scopeQuery,
  previewSize,
  onOrderChange,
  onPreviewSizeChange,
  onIncludeDescendantsChange,
  onScopeChange,
  mode,
  onOpenDrawer,
}: NoteListProps): ReactElement {
  const t = useT();
  const compact = mode !== 'desktop';
  const [menuOpen, setMenuOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<NoteRowMenuRequest | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const exportRunner = useExportRunner();

  const closeRowMenu = useCallback(() => setRowMenu(null), []);

  // The menu acts on the row it was opened on, which is not necessarily the
  // selected one — right-clicking a row deliberately does NOT select it, so
  // every action below is addressed by `rowMenu.noteId`.
  const rowNote = rowMenu === null ? null : (items?.find((n) => n.id === rowMenu.noteId) ?? null);

  function runRowAction(action: NoteRowAction): void {
    if (rowMenu === null || rowNote === null) return;

    switch (action) {
      case 'pin':
        onTogglePin(rowNote.id, !rowNote.pinned);
        return;
      case 'duplicate':
        onDuplicate(rowNote.id);
        return;
      case 'copyText':
        setCopyFailed(false);
        // `navigator.clipboard` is absent under jsdom and over plain HTTP on
        // a non-localhost origin, and `writeText` rejects when the document
        // is not focused. Every one of those is silent without this branch,
        // so the failure is reported rather than swallowed.
        void (
          navigator.clipboard?.writeText(rowNote.text) ?? Promise.reject(new Error('no clipboard'))
        ).catch(() => setCopyFailed(true));
        return;
      case 'trash':
        onTrash(rowNote.id);
        return;
      case 'restore':
        onRestore(rowNote.id);
        return;
      case 'purge':
        onPurge(rowNote.id);
        return;
    }
  }

  const scopeName = scope.kind === 'tag' ? scope.tag : t(SMART_LIST_LABELS[scope.list]);

  // A control that acts on the selected note must not render when that note
  // is not on screen: `items` is the query-narrowed view, so a note the
  // query has filtered out is not visible even though it stays selected (a
  // query never deselects the open note). Gating on `selectedNoteId !== null`
  // alone let "Move to trash" / "Restore" / "Delete forever" render for a row
  // the user cannot see.
  const selectedIsVisible =
    selectedNoteId !== null && (items ?? []).some((note) => note.id === selectedNoteId);

  return (
    <div className="relative flex h-full flex-col">
      {/*
        `ghost`, not `default`, and that is a DELIBERATE REVERSAL of M6's ruling
        for this strip alone.

        M6 gave these buttons a border and a fill because without them "New
        note" and "Move to trash" were indistinguishable from static text until
        the pointer happened to cross them. The chrome fixed that and made the
        header read as a row of form controls, which is the single thing that
        most dated the app. Bear's own header carries quiet, borderless icons in
        a fixed strip, and that is what was asked for here.

        What replaces the resting affordance is position and familiarity: a
        dedicated header strip, a standard glyph, an `aria-label`, and a hover
        fill. `Delete forever` and `Empty trash` below deliberately do NOT
        follow — they are irreversible against a database with no server copy,
        so they keep a resting fill. `ConfirmDialog`'s Cancel still uses
        `default`, so the variant and its ruling both stay live.
      */}
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {/*
          Below desktop there is no sidebar pane, so this is the only route to
          the tag tree. Bear's own phone header puts it in exactly this corner.
        */}
        {compact && (
          <Button variant="ghost" onClick={onOpenDrawer} label={t('sidebar.open')}>
            <Icon glyph={Menu} size="sm" />
          </Button>
        )}
        {/*
          The first thing in the app that names the active scope on screen.
          Until now the only indication was the sidebar's `aria-current` row,
          which is why activating a tag pill has to reveal collapsed ancestors.
          `deferred.md` carried this gap from M3 through M9a.

          Title left, controls right — the reading order of Bear's own header.
        */}
        <div className="relative">
          <Button
            variant="ghost"
            onClick={() => setMenuOpen((open) => !open)}
            ariaHasPopup="menu"
            ariaExpanded={menuOpen}
            // Deliberately NOT just the scope name. The sidebar already has a
            // row named "Notes", and two controls with an identical accessible
            // name is ambiguous to a screen-reader user reaching for either.
            // The visible label is still contained in the name, as WCAG 2.5.3
            // requires, and the prefix says what the button actually does —
            // "Notes" alone does not convey that it opens anything.
            label={t('noteList.menu.open').replace('{scope}', scopeName)}
            className="gap-1"
          >
            {scopeName}
            <Icon glyph={ChevronDown} size="sm" />
          </Button>

          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            label={t('noteList.menu.label')}
            className="absolute top-full left-0 z-10 mt-1"
          >
            <ScopeMenu
              scope={scope}
              count={count}
              scopeQuery={scopeQuery}
              previewSize={previewSize}
              onOrderChange={onOrderChange}
              onPreviewSizeChange={onPreviewSizeChange}
              onIncludeDescendantsChange={onIncludeDescendantsChange}
              onScopeChange={(next) => {
                onScopeChange(next);
                setMenuOpen(false);
              }}
            />
          </Popover>
        </div>

        {/*
          The create button and the three selection actions are DESKTOP ONLY.

          Create moves to the FAB below. The other three act on the SELECTED
          note, and below desktop selecting a note means leaving the list
          (phone) or is already visible beside it (tablet) — so a header button
          naming "the selected note" was never coherent there. All three live
          in the row's own context menu, which is what makes this header
          shrinkable at all.
        */}
        {!compact && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={onCreate}
            label={t('noteList.create')}
          >
            <Icon glyph={SquarePen} />
          </Button>
        )}

        {!compact && selectedIsVisible && allowsTrash(scope) && (
          <Button variant="ghost" onClick={() => onTrash(selectedNoteId!)}>
            {t('noteList.trash')}
          </Button>
        )}
        {!compact && selectedIsVisible && isTrash(scope) && (
          <Button variant="ghost" onClick={() => onRestore(selectedNoteId!)}>
            {t('noteList.restore')}
          </Button>
        )}
        {!compact && selectedIsVisible && isTrash(scope) && (
          <Button variant="danger" onClick={() => onPurge(selectedNoteId!)}>
            {t('noteList.deleteForever')}
          </Button>
        )}
        {/*
          Empty trash STAYS in the header at every size, unlike the three
          selection actions above. The spec proposed moving it into
          `ScopeMenu`; it fits at 390px beside the drawer, scope and search
          controls, and an irreversible action reads worse buried in a menu of
          view preferences than beside the scope it belongs to.
        */}
        {isTrash(scope) && (
          <Button
            variant="danger"
            className="ml-auto"
            disabled={emptyTrashDisabled}
            onClick={onEmptyTrash}
          >
            {t('noteList.emptyTrash')}
          </Button>
        )}
      </div>

      <div className="flex shrink-0 items-center border-b border-border px-2 py-1">
        <SearchField query={query} onQueryChange={onQueryChange} inputRef={searchInputRef} />
      </div>

      {/* `undefined` is "not loaded yet", not "empty": showing the empty state
          during the first frame would flash "No notes" on every reload. */}
      {items === undefined ? null : items.length === 0 ? (
        hasQuery(query) && hasUnfilteredItems ? (
          <EmptyState title={t('noteList.noResults.title')} body={t('noteList.noResults.body')} />
        ) : (
          <EmptyState title={t(emptyTitle(scope))} body={t(emptyBody(scope))} />
        )
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              onSelect={() => onSelect(note.id)}
              onTogglePin={onTogglePin}
              onOpenMenu={setRowMenu}
              query={query}
              size={previewSize}
            />
          ))}
        </ul>
      )}

      {/*
        The create button, below desktop. `absolute`, so it floats over the
        list rather than taking a row from it, which is what a FAB is for.

        `env(safe-area-inset-bottom)` on this control alone. General safe-area
        handling is J4, but a floating control placed in the exact spot the OS
        reserves for the home indicator cannot wait for it — it would sit under
        the indicator on every notched phone.

        It reuses `noteList.create` rather than inventing a second string: the
        same action must not announce two different ways depending on the
        viewport.
      */}
      {compact && (
        <button
          type="button"
          aria-label={t('noteList.create')}
          onClick={onCreate}
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          className="bg-accent shadow-popover ease-bear absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full text-white transition-transform duration-[var(--bear-duration-fast)] active:scale-95"
        >
          <Icon glyph={Plus} />
        </button>
      )}

      {/* One line for both failure sources. They are mutually exclusive in
          practice — a menu action is one action — and `status` rather than
          `alert`, because `alert` is the degraded-storage banner's role and
          the e2e suite asserts there is exactly one of those. */}
      {(exportRunner.failureKey !== null || copyFailed) && (
        <p role="status" className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted">
          {copyFailed ? t('note.copyText.failed') : t(exportRunner.failureKey!)}
        </p>
      )}

      {rowMenu !== null && rowNote !== null && (
        <NoteRowMenu
          request={rowMenu}
          onAction={runRowAction}
          onExport={(format) => {
            setCopyFailed(false);
            exportRunner.run(
              {
                title: deriveTitle(rowNote.text),
                text: rowNote.text,
                updatedAt: rowNote.updatedAt,
              },
              format,
            );
          }}
          onClose={closeRowMenu}
        />
      )}
    </div>
  );
}
