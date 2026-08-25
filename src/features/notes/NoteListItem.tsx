import { type ReactElement, useState } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';
import { Icon, Pin } from '@/ui/Icon';

import { deriveSnippet, formatNoteDate } from './format';
import { HighlightedText } from './HighlightedText';
import type { NoteRowMenuRequest } from './NoteRowMenu';
import { DEFAULT_PREVIEW_SIZE, type PreviewSize, snippetLines } from './preview';
import { firstImageUrl } from './thumbnail';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Opens the row's action menu — right-click, or Shift+F10 with the row focused. */
  onOpenMenu: (request: NoteRowMenuRequest) => void;
  /** The current time, for deciding whether a note's date renders as a time or a date. Defaults to the wall clock; tests pin it. */
  now?: number;
  /** The active search query, if any. Highlights matches and steers the snippet to the matching line. */
  query?: string;
  /** Row density. Defaults to `large`, the row the app shipped with. */
  size?: PreviewSize;
}

export function NoteListItem({
  note,
  selected,
  onSelect,
  onTogglePin,
  onOpenMenu,
  now,
  query,
  size = DEFAULT_PREVIEW_SIZE,
}: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const hasTitle = note.title !== '';
  const displayTitle = hasTitle ? note.title : t('note.untitled');
  const date = formatNoteDate(note.updatedAt, locale, now ?? Date.now());
  const snippet = deriveSnippet(note.text, query);
  const hasSnippet = snippet !== '';
  const displaySnippet = hasSnippet ? snippet : t('note.noText');

  const lines = snippetLines(size);

  // A remote URL can 404, expire, or be behind a login. `onError` is the only
  // signal that happens, and without acting on it the row keeps a broken-image
  // box forever. Keyed off the URL so a note edited to point somewhere new
  // gets a fresh attempt rather than staying suppressed by the old failure.
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  // Suppressed at the Small density, which shows no snippet either: that size
  // exists to fit as many rows on screen as possible, and a 64px picture in a
  // row deliberately stripped of its preview line would be the tallest thing
  // in it.
  const imageUrl = lines === 0 ? null : firstImageUrl(note.text);
  const showImage = imageUrl !== null && imageUrl !== brokenImage;

  // Built from the SAME size decision that drives the render below, so the
  // accessible name can never announce a snippet the row does not display.
  //
  // The explicit commas remain load-bearing: the spans concatenate with no
  // separator and accessible-name computation ignores the CSS gap between
  // them, which is why this row announced as "Groceries14:32milk and bread"
  // from M3 until M7. The label also keeps the highlight markup out of the
  // name.
  //
  // The thumbnail contributes nothing: its `alt` is empty, deliberately. The
  // image is decoration derived from text the snippet already carries, and a
  // filename read aloud between the preview and the date is noise.
  const label =
    lines === 0 ? `${displayTitle}, ${date}` : `${displayTitle}, ${date}, ${displaySnippet}`;

  function openMenu(rect: DOMRect): void {
    onOpenMenu({ noteId: note.id, pinned: note.pinned, trashed: note.trashedAt !== null, rect });
  }

  return (
    <li
      // A chip, not a band. Soft Depth insets the row and rounds it, so the
      // 4px of list ground between rows is what separates them — which is why
      // the hairline divider this row used to draw is gone.
      className={`ease-bear relative mx-2 my-1 overflow-hidden rounded-md transition-colors duration-[var(--bear-duration-fast)] ${
        selected ? 'bg-selected' : ''
      }`}
      onContextMenu={(event) => {
        event.preventDefault();
        // A zero-size rect at the pointer — the menu's flip/clamp reads
        // `.top`, `.bottom` and `.left` and nothing else, so a degenerate
        // rect anchors it exactly at the click point with no special case.
        openMenu(new DOMRect(event.clientX, event.clientY, 0, 0));
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={(event) => {
          // The conventional keyboard route to a context menu. Without it the
          // row's actions would be pointer-only, which for Delete and Restore
          // means a keyboard user has no route to them from the list at all.
          if (event.key !== 'F10' || !event.shiftKey) return;
          event.preventDefault();
          openMenu(event.currentTarget.getBoundingClientRect());
        }}
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className={`ease-bear flex w-full min-w-0 flex-col gap-0.5 p-3 text-left transition-colors duration-[var(--bear-duration-fast)] ${
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

        {/*
          The preview lines are RESERVED rather than allowed to collapse: a
          list whose rows change height with their content reads as ragged,
          and a body-less note still occupies a full row. `line-clamp-N` caps
          it; `min-h` holds it. `leading-snug` rather than the inherited UI
          leading, so two lines fit in the height one line used to occupy plus
          a little.

          That is true at EVERY density, which is why each size clamps and
          reserves its own height rather than one constant serving all three.

          The preview sits directly under the title now, where the date used
          to — M9c moved the date to the row's footer. The eye lands on the
          title and continues into the note's own words rather than stepping
          over a timestamp to reach them.
        */}
        {lines === 1 && (
          <span className="line-clamp-1 min-h-[1.03125rem] text-ui-sm leading-snug text-muted">
            <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
          </span>
        )}
        {lines === 2 && (
          <span className="line-clamp-2 min-h-[2.0625rem] text-ui-sm leading-snug text-muted">
            <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
          </span>
        )}

        {/*
          Height is fixed and width is not: the thumbnails then share a
          baseline down the list however differently shaped the images are,
          which a fixed WIDTH would not give. Nothing is reserved when a note
          has no image — unlike the preview lines above, whose reservation
          exists to stop the rows going ragged. A thumbnail is rare enough
          that reserving space for it in every row would leave most rows with
          a permanent hole instead.

          `alt=""` because the image is decoration: it is derived from the
          note's own text, which the preview line above already announces.
        */}
        {showImage && (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBrokenImage(imageUrl)}
            className="border-border mt-1 h-16 max-w-full self-start rounded-sm border object-cover"
          />
        )}

        {/*
          `pl-6` reserves the pin's slot — 24px, which clears the pin button's
          own box (8px from the row's left edge, 22px wide) with a few pixels
          to spare. 20px would have been the tighter fit and is off
          `sourceLint`'s permitted spacing scale. The pin cannot live inside this
          element — a `<button>` inside a `<button>` is invalid HTML and
          unclickable in some browsers (`docs/rulings/accessibility.md`) — so
          it is absolutely positioned over this line as a sibling below, and
          this padding is what keeps the date clear of it.
        */}
        <span className="mt-1 pl-6 text-ui-xs text-faint">{date}</span>
      </button>

      <button
        type="button"
        aria-label={note.pinned ? t('note.unpin') : t('note.pin')}
        aria-pressed={note.pinned}
        onClick={() => onTogglePin(note.id, !note.pinned)}
        // Sits on the footer line beside the date rather than centred on the
        // row's right edge, which is where it lived until M9c. The pin marks
        // the note's state, and state belongs with the metadata line, not
        // floating in the middle of the content.
        className={`ease-bear absolute bottom-2 left-2 p-1 transition-colors duration-[var(--bear-duration-fast)] hover:text-accent ${
          // Reads by colour, never by glyph: a slashed pin in the unpinned
          // state reads as "pinning is unavailable" (the grammar of a
          // muted-mic glyph), not "click to pin".
          note.pinned ? 'text-accent' : 'text-faint'
        }`}
      >
        <Icon glyph={Pin} size="sm" />
      </button>
    </li>
  );
}
