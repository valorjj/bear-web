import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';

import { NoteListItem } from './NoteListItem';
import type { NoteScope } from './scope';

export interface NoteListProps {
  scope: NoteScope;
  /** `undefined` while the live query has not yet resolved. */
  items: Note[] | undefined;
  selectedNoteId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
}

export function NoteList({
  scope,
  items,
  selectedNoteId,
  onSelect,
  onCreate,
  onTrash,
  onRestore,
}: NoteListProps): ReactElement {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Button onClick={onCreate}>{t('noteList.create')}</Button>

        {selectedNoteId !== null && scope === 'active' && (
          <Button onClick={() => onTrash(selectedNoteId)}>{t('noteList.trash')}</Button>
        )}
        {selectedNoteId !== null && scope === 'trashed' && (
          <Button onClick={() => onRestore(selectedNoteId)}>{t('noteList.restore')}</Button>
        )}
      </div>

      {/* `undefined` is "not loaded yet", not "empty": showing the empty state
          during the first frame would flash "No notes" on every reload. */}
      {items === undefined ? null : items.length === 0 ? (
        <EmptyState
          title={scope === 'active' ? t('noteList.empty.title') : t('trash.empty.title')}
          body={scope === 'active' ? t('noteList.empty.body') : t('trash.empty.body')}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              onSelect={() => onSelect(note.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
