import { type ReactElement, useEffect, useRef } from 'react';

import { useT } from '@/i18n';

import type { HighlightColor } from './Highlight';
import { HIGHLIGHT_CHOICES } from './highlightChoices';

export interface HighlightMenuProps {
  /** The colour currently under the cursor, or `null` for the default tint. */
  current: HighlightColor | null;
  onChoose: (color: HighlightColor | null) => void;
  /** Closes without choosing — Escape, or a click elsewhere. */
  onDismiss: () => void;
}

/**
 * The highlight colours, as a menu under the toolbar's colour chevron.
 *
 * `menuitemradio` rather than `menuitem`: the choices are mutually exclusive
 * and one of them is always in effect, which is exactly the semantics
 * `aria-checked` carries. The swatch alone would leave a screen-reader user
 * with five identically-named buttons.
 *
 * Focus moves to the checked item on open and Escape returns to the opener,
 * for the same reason `ExportMenu` does it: the control that opens this is
 * icon-only, so a keyboard user who cannot get in has no route to a colour
 * at all.
 */
export function HighlightMenu({ current, onChoose, onDismiss }: HighlightMenuProps): ReactElement {
  const t = useT();
  const checked = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    checked.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="menu"
      aria-label={t('editor.highlight.menu')}
      className="flex min-w-36 flex-col gap-0.5 rounded-lg bg-surface p-1 shadow-popover"
    >
      {HIGHLIGHT_CHOICES.map((choice) => (
        <button
          key={choice.color ?? 'default'}
          ref={choice.color === current ? checked : undefined}
          type="button"
          role="menuitemradio"
          aria-checked={choice.color === current}
          onClick={() => onChoose(choice.color)}
          className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-ui text-text transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-checked:bg-selected"
        >
          <span
            aria-hidden="true"
            className={`size-3.5 shrink-0 rounded-full border border-border ${choice.swatch}`}
          />
          {t(choice.label)}
        </button>
      ))}
    </div>
  );
}
