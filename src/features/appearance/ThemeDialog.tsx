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
 * **Each card paints itself.** It carries `data-theme` on its own element, so
 * the cascade colours it and no colour ever enters TypeScript — the same
 * trick the old sixteen-pixel swatch used, scaled up to something that
 * actually shows a palette. A palette edit updates this component for free.
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
        // `system` deliberately carries NO attribute, so the card inherits
        // whatever the document is currently showing — which is exactly what
        // choosing System means, and is how the app itself represents it.
        data-theme={value === 'system' ? undefined : value}
        onClick={() => onChoose(value)}
        className={`bg-bg ease-bear flex min-w-0 flex-col gap-1 rounded-md p-3 text-left transition-shadow duration-[var(--bear-duration-fast)] ${
          active
            ? 'ring-accent shadow-popover ring-2'
            : 'border-border hover:ring-border border ring-1 ring-transparent'
        }`}
      >
        <span aria-hidden="true" className="text-ui-md text-text truncate">
          {label}
        </span>
        <span aria-hidden="true" className="text-ui-sm text-muted line-clamp-2">
          {t('appearance.sample')}
        </span>
        <span aria-hidden="true" className="text-ui-sm text-accent truncate">
          {t('appearance.sampleAccent')}
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
