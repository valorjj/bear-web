import type { ReactElement, RefObject } from 'react';

import type { Note } from '@/data';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';

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
   * Optional so `AppShell` can keep rendering `NoteList` before Task 7 wires
   * the field through. Defaults are deliberately plain: an empty string and a
   * no-op, never a value that would silently mask a missing wire-up.
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
  query = '',
  onQueryChange = () => {},
  searchInputRef,
}: NoteListProps): ReactElement {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button onClick={onCreate}>{t('noteList.create')}</Button>

        {selectedNoteId !== null && allowsTrash(scope) && (
          <Button onClick={() => onTrash(selectedNoteId)}>{t('noteList.trash')}</Button>
        )}
        {selectedNoteId !== null && isTrash(scope) && (
          <Button onClick={() => onRestore(selectedNoteId)}>{t('noteList.restore')}</Button>
        )}
        {selectedNoteId !== null && isTrash(scope) && (
          <Button variant="danger" onClick={() => onPurge(selectedNoteId)}>
            {t('noteList.deleteForever')}
          </Button>
        )}
        {isTrash(scope) && (
          <Button
            variant="danger"
            disabled={items === undefined || items.length === 0}
            onClick={onEmptyTrash}
          >
            {t('noteList.emptyTrash')}
          </Button>
        )}
      </div>

      <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
        <SearchField query={query} onQueryChange={onQueryChange} inputRef={searchInputRef} />
      </div>

      {/* `undefined` is "not loaded yet", not "empty": showing the empty state
          during the first frame would flash "No notes" on every reload. */}
      {items === undefined ? null : items.length === 0 ? (
        hasQuery(query) ? (
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
