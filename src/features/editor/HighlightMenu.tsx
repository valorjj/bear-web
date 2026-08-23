import { type ReactElement, useEffect, useRef } from 'react';

import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

import type { HighlightColor } from './Highlight';

export interface HighlightMenuProps {
  /** The colour currently under the cursor, or `null` for the default tint. */
  current: HighlightColor | null;
  onChoose: (color: HighlightColor | null) => void;
  /** Closes without choosing — Escape, or a click elsewhere. */
  onDismiss: () => void;
}

interface Choice {
  color: HighlightColor | null;
  label: TranslationKey;
  /**
   * The Tailwind utility for this swatch's fill. Written out rather than
   * interpolated from the colour name: Tailwind scans source text for whole
   * class names, so a `bg-hl-${color}` template would compile to nothing at
   * all — the same silent-no-output failure mode `--color-hover`'s two-
   * milestone absence had.
   */
  swatch: string;
}

const CHOICES: readonly Choice[] = [
  // The default leads, because it is what every existing `==text==` already
  // is and the colours are the addition.
  { color: null, label: 'editor.highlight.default', swatch: 'bg-selected' },
  { color: 'blue', label: 'editor.highlight.blue', swatch: 'bg-hl-blue' },
  { color: 'green', label: 'editor.highlight.green', swatch: 'bg-hl-green' },
  { color: 'pink', label: 'editor.highlight.pink', swatch: 'bg-hl-pink' },
  { color: 'purple', label: 'editor.highlight.purple', swatch: 'bg-hl-purple' },
];

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
      {CHOICES.map((choice) => (
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
