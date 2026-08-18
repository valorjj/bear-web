import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';
import { Icon, Pin } from '@/ui/Icon';

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
    <li
      className={`relative flex items-stretch transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
        selected ? 'bg-selected' : ''
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
          selected ? '' : 'hover:bg-hover'
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
        <span className="text-ui-xs text-faint">{date}</span>
        {/*
          Two lines of preview, and the space for the second is RESERVED rather
          than allowed to collapse: Bear's list rows are a uniform height whether
          or not a note has a body (measured — a body-less note still occupies a
          full row), and a list whose rows change height with their content reads
          as ragged. `line-clamp-2` caps it; `min-h` holds it. `leading-snug`
          rather than the inherited UI leading, so two lines fit in the height one
          line used to occupy plus a little.
        */}
        <span className="line-clamp-2 min-h-[2.0625rem] text-ui-sm leading-snug text-muted">
          <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
        </span>
      </button>

      {/*
        The divider is an inset absolute rule rather than a `border-b` on the
        row, so it starts clear of the left edge the way Bear's does while the
        hover and selected fills still span the full width. A `border-b` on this
        element cannot be inset without insetting the fill with it.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 left-3 h-px bg-border"
      />

      <button
        type="button"
        aria-label={note.pinned ? t('note.unpin') : t('note.pin')}
        aria-pressed={note.pinned}
        onClick={() => onTogglePin(note.id, !note.pinned)}
        className={`shrink-0 px-2 text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-accent ${
          note.pinned ? 'text-accent' : 'text-faint'
        }`}
      >
        <Icon glyph={Pin} size="sm" />
      </button>
    </li>
  );
}
