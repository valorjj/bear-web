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
      // A chip, not a band. Soft Depth insets the row and rounds it, so the
      // 4px of list ground between rows is what separates them — which is why
      // the hairline divider this row used to draw is gone.
      className={`ease-bear relative mx-2 my-1 flex items-stretch overflow-hidden rounded-md transition-colors duration-[var(--bear-duration-fast)] ${
        selected ? 'bg-selected' : ''
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className={`ease-bear flex min-w-0 flex-1 flex-col gap-0.5 p-3 text-left transition-colors duration-[var(--bear-duration-fast)] ${
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
        No divider. Until M9a this row drew an inset hairline so it started
        clear of the left edge the way Bear's does. Rows are chips now — inset,
        rounded, with list ground between them — and a rule inside a chip reads
        as the chip being cut in half rather than as a separator.
      */}

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
