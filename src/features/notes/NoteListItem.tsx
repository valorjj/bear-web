import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';

import { deriveSnippet, formatNoteDate } from './format';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  /** The current time, for deciding whether a note's date renders as a time or a date. Defaults to the wall clock; tests pin it. */
  now?: number;
}

export function NoteListItem({ note, selected, onSelect, now }: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const snippet = deriveSnippet(note.text);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`relative flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
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
    </li>
  );
}
