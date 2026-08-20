import { type ReactElement, useState } from 'react';

import type { ThemeChoice } from '@/app/theme';
import { useTheme } from '@/app/useTheme';
import { useT } from '@/i18n';
import { THEMES } from '@/styles/themes';
import { Icon, Palette } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

const GROUPS = [
  { group: 'light', labelKey: 'appearance.group.light' },
  { group: 'dark', labelKey: 'appearance.group.dark' },
] as const;

/**
 * The theme picker: a trigger in the sidebar footer and a grouped list.
 *
 * The whole runtime is one attribute on `<html>`; every colour follows through
 * the cascade. That is why this component contains no colour of its own, and
 * why each row's swatch carries `data-theme` on ITSELF — the swatch previews
 * its theme by being rendered inside it, so a palette edit updates the picker
 * for free and no colour is ever duplicated into TypeScript.
 */
export function ThemePicker(): ReactElement {
  const t = useT();
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);

  function pick(next: ThemeChoice): void {
    setChoice(next);
    setOpen(false);
  }

  function row(value: ThemeChoice, label: string): ReactElement {
    const active = choice === value;
    return (
      <button
        key={value}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={() => pick(value)}
        className={`text-ui ease-bear flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-[var(--bear-duration-fast)] ${
          active ? 'bg-selected text-text font-medium' : 'text-text hover:bg-hover'
        }`}
      >
        <span
          aria-hidden="true"
          // `system` deliberately carries no attribute, so its swatch inherits
          // whatever the document is currently showing — which is exactly what
          // choosing System means.
          data-theme={value === 'system' ? undefined : value}
          className="border-border bg-canvas flex size-4 shrink-0 items-center justify-center rounded-sm border"
        >
          <span className="bg-accent size-2 rounded-[1px]" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
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
        <Popover
          open
          onClose={() => setOpen(false)}
          label={t('appearance.label')}
          className="absolute bottom-full left-0 z-10 mb-2 w-44"
        >
          {row('system', t('appearance.system'))}
          {GROUPS.map(({ group, labelKey }) => (
            <div key={group} role="group" aria-label={t(labelKey)}>
              <p className="text-ui-xs text-faint px-2 pt-2 pb-0.5">{t(labelKey)}</p>
              {THEMES.filter((theme) => theme.group === group).map((theme) =>
                row(theme.id, t(theme.labelKey)),
              )}
            </div>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
