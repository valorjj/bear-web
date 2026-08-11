import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';

import { deriveSnippet, formatNoteDate } from './format';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** The current time, for deciding whether a note's date renders as a time or a date. Defaults to the wall clock; tests pin it. */
  now?: number;
}

export function NoteListItem({
  note,
  selected,
  onSelect,
  onTogglePin,
  now,
}: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const snippet = deriveSnippet(note.text);

  return (
    <li className="relative flex items-stretch border-b border-border">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
          selected ? 'bg-selected' : 'hover:bg-hover'
        }`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
        )}

        <span className="truncate text-ui-md font-semibold text-text">
          {note.title === '' ? t('note.untitled') : note.title}
        </span>
        <span className="text-ui-sm text-faint">
          {formatNoteDate(note.updatedAt, locale, now ?? Date.now())}
        </span>
        <span className="truncate text-ui-sm text-muted">
          {snippet === '' ? t('note.noText') : snippet}
        </span>
      </button>

      <button
        type="button"
        aria-label={note.pinned ? t('note.unpin') : t('note.pin')}
        aria-pressed={note.pinned}
        onClick={() => onTogglePin(note.id, !note.pinned)}
        className={`shrink-0 px-2 text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-accent ${
          note.pinned ? 'text-accent' : 'text-faint'
        }`}
      >
        ●
      </button>
    </li>
  );
}
