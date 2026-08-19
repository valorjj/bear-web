import type { ReactElement, RefObject } from 'react';

import type { Note } from '@/data';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, SquarePen } from '@/ui/Icon';

import { NoteListItem } from './NoteListItem';
import { hasQuery } from './search';
import { SearchField } from './SearchField';
import { allowsTrash, isTrash, type NoteScope } from './scope';

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
  onEmptyTrash,
  emptyTrashDisabled,
  hasUnfilteredItems,
  query = '',
  onQueryChange = () => {},
  searchInputRef,
}: NoteListProps): ReactElement {
  const t = useT();

  // A control that acts on the selected note must not render when that note
  // is not on screen: `items` is the query-narrowed view, so a note the
  // query has filtered out is not visible even though it stays selected (a
  // query never deselects the open note). Gating on `selectedNoteId !== null`
  // alone let "Move to trash" / "Restore" / "Delete forever" render for a row
  // the user cannot see.
  const selectedIsVisible =
    selectedNoteId !== null && (items ?? []).some((note) => note.id === selectedNoteId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button onClick={onCreate} label={t('noteList.create')}>
          <Icon glyph={SquarePen} />
        </Button>

        {selectedIsVisible && allowsTrash(scope) && (
          <Button onClick={() => onTrash(selectedNoteId!)}>{t('noteList.trash')}</Button>
        )}
        {selectedIsVisible && isTrash(scope) && (
          <Button onClick={() => onRestore(selectedNoteId!)}>{t('noteList.restore')}</Button>
        )}
        {selectedIsVisible && isTrash(scope) && (
          <Button variant="danger" onClick={() => onPurge(selectedNoteId!)}>
            {t('noteList.deleteForever')}
          </Button>
        )}
        {isTrash(scope) && (
          <Button variant="danger" disabled={emptyTrashDisabled} onClick={onEmptyTrash}>
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
              query={query}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
