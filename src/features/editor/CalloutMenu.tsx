import { type ReactElement, useEffect, useRef } from 'react';

import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';

import { CALLOUT_TYPES, type CalloutType } from './callouts';

export interface CalloutMenuProps {
  /** The type under the cursor; `null` is a plain quote. */
  current: CalloutType | null;
  onChoose: (type: CalloutType | null) => void;
  /** Closes without choosing — Escape, or a click elsewhere. */
  onDismiss: () => void;
}

/**
 * The six choices: a plain quote, then the roster in `callouts.ts`'s order.
 *
 * Derived from `CALLOUT_TYPES` rather than listed again, so a sixth type
 * cannot appear in the schema and be missing from the menu. The label keys are
 * asserted to exist by `TranslationKey`, which is what makes a forgotten
 * translation a compile error rather than a blank row.
 */
const CHOICES: ReadonlyArray<{ type: CalloutType | null; label: TranslationKey }> = [
  { type: null, label: 'editor.callout.plain' },
  ...CALLOUT_TYPES.map((type) => ({
    type,
    label: `editor.callout.${type}` as TranslationKey,
  })),
];

/**
 * The callout types, as a menu under the toolbar's Quote chevron.
 *
 * `menuitemradio` rather than `menuitem`, on the same reasoning as
 * `HighlightMenu`: the choices are mutually exclusive and exactly one is
 * always in effect, which is what `aria-checked` carries. The swatch and the
 * icon alone would leave a screen-reader user with six identically-shaped
 * buttons.
 *
 * Focus moves to the checked item on open and Escape returns to the opener,
 * because the control that opens this is icon-only: a keyboard user who cannot
 * get in has no route to a callout at all.
 */
export function CalloutMenu({ current, onChoose, onDismiss }: CalloutMenuProps): ReactElement {
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
      aria-label={t('editor.callout.menu')}
      className="flex min-w-36 flex-col gap-0.5 rounded-lg bg-surface p-1 shadow-popover"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice.type ?? 'plain'}
          ref={choice.type === current ? checked : undefined}
          type="button"
          role="menuitemradio"
          aria-checked={choice.type === current}
          onClick={() => onChoose(choice.type)}
          className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-ui text-text transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-checked:bg-selected"
        >
          {/*
            The same glyph the block itself draws, from the same tokens — a
            mask over the type's edge hue, keyed by `data-type` in
            `editor.css`. NOT an interpolated Tailwind class and not an inline
            style: Tailwind scans source text for whole class names, so a
            `bg-cal-${type}` template compiles to nothing at all — the silent
            no-output failure `--color-hover` had for two milestones. The same
            trap `HIGHLIGHT_CHOICES` writes its swatches out longhand to avoid.
          */}
          <span aria-hidden="true" className="bear-cal-swatch" data-type={choice.type ?? 'plain'} />
          {t(choice.label)}
        </button>
      ))}
    </div>
  );
}
