import { type ReactElement, useState } from 'react';

import { useTypography } from '@/app/useTypography';
import { useT } from '@/i18n';
import { Icon, TypeGlyph } from '@/ui/Icon';

import { TypographyPanel } from './TypographyPanel';

/**
 * The sidebar-footer trigger, a sibling of `ThemePicker` in the same sense
 * `AccountMenu` is — a second small control in the same strip, not a new
 * chrome region.
 *
 * Modal rather than anchored, for the reason `ThemeDialog` records: the
 * sidebar `Pane` is `overflow-hidden`, so an anchored surface wider than the
 * pane is clipped by it.
 */
export function TypographyButton(): ReactElement {
  const t = useT();
  const { value, set } = useTypography();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('typography.open')}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={TypeGlyph} size="md" />
      </button>

      {open ? (
        <TypographyPanel value={value} onCommit={set} onDismiss={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
