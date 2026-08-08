import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';

import { deriveSnippet, formatNoteDate } from './format';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
}

export function NoteListItem({ note, selected, onSelect }: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const snippet = deriveSnippet(note.text);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left ${
          selected ? 'bg-bg' : 'hover:bg-bg'
        }`}
      >
        <span className="truncate text-sm font-medium text-text">
          {note.title === '' ? t('note.untitled') : note.title}
        </span>
        <span className="text-xs text-muted">
          {formatNoteDate(note.updatedAt, locale, Date.now())}
        </span>
        <span className="truncate text-xs text-muted">
          {snippet === '' ? t('note.noText') : snippet}
        </span>
      </button>
    </li>
  );
}
