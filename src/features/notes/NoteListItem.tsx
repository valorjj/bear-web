import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';
import { Icon, Pin, PinOff } from '@/ui/Icon';

import { deriveSnippet, formatNoteDate } from './format';
import { HighlightedText } from './HighlightedText';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** The current time, for deciding whether a note's date renders as a time or a date. Defaults to the wall clock; tests pin it. */
  now?: number;
  /** The active search query, if any. Highlights matches and steers the snippet to the matching line. */
  query?: string;
}

export function NoteListItem({
  note,
  selected,
  onSelect,
  onTogglePin,
  now,
  query,
}: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const hasTitle = note.title !== '';
  const displayTitle = hasTitle ? note.title : t('note.untitled');
  const date = formatNoteDate(note.updatedAt, locale, now ?? Date.now());
  const snippet = deriveSnippet(note.text, query);
  const hasSnippet = snippet !== '';
  const displaySnippet = hasSnippet ? snippet : t('note.noText');

  // Explicit, because the three spans below concatenate with no separator and
  // accessible-name computation ignores the CSS gap between them: this row
  // announced as "Groceries14:32milk and bread" from M3 until M7. The label
  // also keeps the highlight markup out of the name.
  const label = `${displayTitle}, ${date}, ${displaySnippet}`;

  return (
    <li className="relative flex items-stretch border-b border-border">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className={`flex min-w-0 flex-1 flex-col gap-1 px-3 py-3 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
          selected ? 'bg-selected' : 'hover:bg-hover'
        }`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
        )}

        <span className="truncate text-ui-md font-semibold text-text">
          {/* `query` is withheld when the text shown is an i18n placeholder
              ("Untitled", "No additional text") rather than the note's own
              content — otherwise a query that happens to match placeholder
              text (e.g. "text" against "No additional text") highlights it as
              though the user had written it. */}
          <HighlightedText text={displayTitle} query={hasTitle ? query : undefined} />
        </span>
        <span className="text-ui-sm text-faint">{date}</span>
        <span className="truncate text-ui-sm text-muted">
          <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
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
        <Icon glyph={note.pinned ? Pin : PinOff} size="sm" />
      </button>
    </li>
  );
}
