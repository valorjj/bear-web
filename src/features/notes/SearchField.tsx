import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon, Search, X } from '@/ui/Icon';

export interface SearchFieldProps {
  query: string;
  onQueryChange: (next: string) => void;
  /** So `AppShell` can focus the field from a keyboard shortcut. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /**
   * Whether the field hides behind a button until asked for.
   *
   * True below `desktop`, where the header has three other controls and 390px
   * to fit them in. False on desktop, where the field has its own strip and
   * hiding it would cost a click for no reason.
   */
  collapsible?: boolean;
  /** Forces the field open. For tests; the component owns this state otherwise. */
  open?: boolean;
}

export function SearchField({
  query,
  onQueryChange,
  inputRef,
  collapsible = false,
  open,
}: SearchFieldProps): ReactElement {
  const t = useT();
  const [opened, setOpened] = useState(false);
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;

  // An active query keeps the field open however it was opened: collapsing it
  // would leave the list filtered by something the user can no longer see, and
  // no way to tell why notes are missing. Also covers the keyboard shortcut,
  // which focuses the field without going through the button.
  const isOpen = !collapsible || open === true || opened || query !== '';

  useEffect(() => {
    if (opened) ref.current?.focus();
  }, [opened, ref]);

  if (!isOpen) {
    return (
      <Button variant="soft" size="touch" onClick={() => setOpened(true)} label={t('search.open')}>
        <Icon glyph={Search} />
      </Button>
    );
  }

  const field = (
    <div className="relative flex min-w-0 flex-1 items-center">
      <span aria-hidden="true" className="pointer-events-none absolute left-2 text-faint">
        <Icon glyph={Search} size="sm" />
      </span>
      <input
        ref={ref}
        type="search"
        value={query}
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onQueryChange('');
            setOpened(false);
          }
        }}
        // `text-ui-lg` — exactly 1rem — rather than the `text-ui` (13px) every
        // other control uses. iOS Safari ZOOMS the whole page when an input
        // below 16px takes focus, and leaves the user zoomed in with no way
        // back but pinching. This is the one typography exception the mobile
        // shell makes, and it applies at every width: a desktop field at 16px
        // costs nothing, and branching the size on layout mode would make the
        // rule invisible at exactly the size it matters.
        // 44px tall on a compact layout — the same target the buttons beside
        // it get, and a 28px field in a 56px bar reads as a leftover from the
        // desktop strip. `rounded-md` there too: a 44px control with a 4px
        // radius looks clipped rather than soft.
        className={`w-full min-w-0 appearance-none border border-border bg-bg py-1 pr-6 pl-8 text-ui-lg text-text placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
          collapsible ? 'h-11 rounded-md' : 'h-7 rounded-sm'
        }`}
      />
      {query !== '' && (
        <button
          type="button"
          aria-label={t('search.clear')}
          onClick={() => {
            onQueryChange('');
            setOpened(false);
          }}
          className="absolute right-1 px-1 text-ui text-faint transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-text"
        >
          <Icon glyph={X} size="sm" />
        </button>
      )}
    </div>
  );

  if (!collapsible) return field;

  // Open, on a compact layout: the field COVERS the header rather than
  // squeezing into a slot beside the drawer button and the title. At 390px a
  // field sharing the bar with two 44px controls and a centred title has
  // nowhere to go, and the reference app covers the bar for the same reason.
  // `absolute inset-0` resolves against the header strip, which is `relative`.
  return (
    <div className="bg-surface absolute inset-0 z-10 flex items-center gap-1 px-2">
      {field}
      <Button
        variant="ghost"
        size="touch"
        onClick={() => {
          // Cancels the search rather than merely hiding the field: leaving a
          // query active behind a closed field would filter the list by
          // something the user can no longer see or clear.
          onQueryChange('');
          setOpened(false);
        }}
        label={t('search.close')}
      >
        <Icon glyph={X} />
      </Button>
    </div>
  );
}
