import { type ReactElement, useState } from 'react';

import type { ThemeChoice } from '@/app/theme';
import { useTheme } from '@/app/useTheme';
import { useT } from '@/i18n';
import { Icon, Palette } from '@/ui/Icon';

import { ThemeDialog } from './ThemeDialog';

/**
 * The theme picker: a trigger in the sidebar footer, opening a modal grid.
 *
 * It was a `Popover` holding a flat list of rows with a sixteen-pixel swatch
 * each. That read acceptably at five themes and not at all at sixteen — a
 * swatch that small conveys almost nothing about a palette, so the name was
 * doing all the work. See `ThemeDialog` for why the replacement is modal
 * rather than a wider popover; the short version is that the sidebar `Pane`
 * is `overflow-hidden` and would clip it.
 *
 * This component contains no colour of its own, and neither does the dialog.
 */
export function ThemePicker(): ReactElement {
  const t = useT();
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);

  function pick(next: ThemeChoice): void {
    setChoice(next);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('appearance.open')}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={Palette} size="md" />
      </button>

      {open ? (
        <ThemeDialog choice={choice} onChoose={pick} onDismiss={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
