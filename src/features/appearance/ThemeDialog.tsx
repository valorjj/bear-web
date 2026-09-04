import { type ReactElement, useEffect, useRef } from 'react';

import type { ThemeChoice } from '@/app/theme';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { THEMES } from '@/styles/themes';
import { Dialog } from '@/ui/Dialog';

export interface ThemeDialogProps {
  choice: ThemeChoice;
  onChoose: (next: ThemeChoice) => void;
  onDismiss: () => void;
}

const GROUPS = [
  { group: 'light', labelKey: 'appearance.group.light' },
  { group: 'dark', labelKey: 'appearance.group.dark' },
] as const;

/**
 * The theme picker, as a scrollable grid of preview cards.
 *
 * **Each card's PREVIEW paints itself; its FRAME does not.** The preview
 * carries `data-theme`, so the cascade colours it and no colour ever enters
 * TypeScript — the same trick the old sixteen-pixel swatch used, scaled up to
 * something that actually shows a palette. A palette edit updates this
 * component for free.
 *
 * The frame around it is deliberately OUTSIDE that boundary, and this
 * paragraph used to say the card carried `data-theme` on its own element,
 * which is exactly what went wrong. With the background and the border both
 * resolving in the card's theme while the dialog panel resolved in the app's,
 * nothing made the two contrast. Measured across all 240 (app theme x card
 * theme) pairs: 52 had the card's fill within 1.10 of the panel, 34 had its
 * border within 1.20, and 4 had both — an invisible card. A user hit
 * `solarized-light` with the `paper` card (fill 1.08, edge 1.20) and reported
 * it.
 *
 * Pinning the dialog to one theme cannot fix that, and the reason is a fact
 * about the roster rather than a preference: it runs from `paper` (pure white)
 * to `high-contrast` (pure black), so no single panel colour contrasts with
 * every card. Only a frame drawn from the APP's palette can, which is why the
 * radio is app-themed chrome and the preview inside it is the only element
 * that paints itself. `e2e/contrast.spec.ts` holds this in place, and its
 * structural half — every frame resolves to one of two app-palette colours —
 * fails even for a pair that happens to contrast.
 *
 * **A modal rather than a popover, and that is forced rather than chosen.**
 * The sidebar `Pane` carries `overflow-hidden`, so an anchored surface wider
 * than the pane is CLIPPED by it — `AccountMenu` had to escape to
 * `position: fixed` with computed coordinates for exactly this. A two-column
 * grid is far wider than the 240px sidebar, so it cannot be anchored there at
 * all. Being modal also means pane width cannot reach it.
 *
 * **`radio` rather than `menuitemradio`.** The old picker was a menu; a grid
 * of previews is a radio group, and one choice is always in effect. The
 * light/dark headings are real headings inside the group rather than nested
 * `role="group"` wrappers, because a `group` between a `radiogroup` and its
 * radios is not a shape ARIA defines.
 */
export function ThemeDialog({ choice, onChoose, onDismiss }: ThemeDialogProps): ReactElement {
  const t = useT();
  const checked = useRef<HTMLButtonElement | null>(null);

  /*
   * Moves focus to the CURRENT choice rather than to the first card.
   *
   * `Dialog` focuses the first focusable, which is right for a confirmation
   * and wrong here: with sixteen themes the current one is usually below the
   * fold, so opening the picker showed a scroll position with no indication
   * of what is selected. Focusing it scrolls it into view for free.
   *
   * This runs AFTER `Dialog`'s own focus effect — React runs child effects
   * before parent ones, and `Dialog` is rendered BY this component, so it is
   * the child.
   */
  useEffect(() => {
    checked.current?.focus();
  }, []);

  function card(value: ThemeChoice, label: string): ReactElement {
    const active = choice === value;
    return (
      <button
        key={value}
        ref={active ? checked : undefined}
        type="button"
        role="radio"
        aria-checked={active}
        // The NAME is the theme's name and nothing else. Without this the
        // card's own text concatenates into it and every one of seventeen
        // radios announces as "Nord The quick brown fox jumps over the lazy
        // dog. a link, and a tag" — the same accessible-name defect class
        // this project has already shipped twice (`SidebarRow`'s lost space,
        // `NoteListItem`'s three concatenated spans). The sample is a
        // PREVIEW: it exists to be looked at, so it is hidden from assistive
        // tech rather than read aloud.
        aria-label={label}
        onClick={() => onChoose(value)}
        /*
         * The FRAME, and it carries no `data-theme` on purpose — see the
         * component docblock. `--bear-faint` rather than `--bear-border`
         * because a hairline is not enough: measured against each theme's own
         * background, `border` runs 1.27–1.31 while `faint` runs 3.33–3.86,
         * and the worst case this replaces was 1.18.
         *
         * A real 1px border in BOTH states, never a ring in one and a border
         * in the other, so selecting a card cannot shift the grid by a pixel
         * — and so `e2e/contrast.spec.ts` can read the frame colour straight
         * off `borderColor` instead of parsing it out of a box-shadow.
         */
        className={`ease-bear block rounded-md border text-left transition-shadow duration-[var(--bear-duration-fast)] ${
          active
            ? 'border-accent ring-accent shadow-popover ring-1'
            : 'border-faint hover:border-muted'
        }`}
      >
        {/*
          The PREVIEW, and the only element that paints itself. Every colour
          inside resolves in this theme; nothing outside it does.

          `system` deliberately carries NO attribute, so the preview inherits
          whatever the document is currently showing — which is exactly what
          choosing System means, and is how the app itself represents it.
        */}
        <span
          aria-hidden="true"
          data-theme={value === 'system' ? undefined : value}
          className="bg-bg flex min-w-0 flex-col gap-1 rounded-[5px] p-3"
        >
          <span className="text-ui-md text-text truncate">{label}</span>
          <span className="text-ui-sm text-muted line-clamp-2">{t('appearance.sample')}</span>
          <span className="text-ui-sm text-accent truncate">{t('appearance.sampleAccent')}</span>
        </span>
      </button>
    );
  }

  return (
    <Dialog
      open
      onClose={onDismiss}
      label={t('appearance.label')}
      className="max-h-[80vh] w-full max-w-lg gap-3 p-4"
    >
      <h2 className="text-ui-lg text-text font-semibold">{t('appearance.label')}</h2>

      <div
        role="radiogroup"
        aria-label={t('appearance.label')}
        // Horizontal padding pulled back by an equal negative margin: the
        // selected card's 2px ring sits OUTSIDE its border box and was being
        // clipped by this scroll container on the left edge.
        className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
      >
        <div className="grid grid-cols-2 gap-3">{card('system', t('appearance.system'))}</div>

        {GROUPS.map(({ group, labelKey }) => (
          <div key={group}>
            <h3 className="text-ui-xs text-faint px-1 pt-4 pb-2">
              {t(labelKey as TranslationKey)}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {THEMES.filter((theme) => theme.group === group).map((theme) =>
                card(theme.id, t(theme.labelKey)),
              )}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
