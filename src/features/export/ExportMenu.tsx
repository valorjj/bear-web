import { type ReactElement, useEffect, useRef } from 'react';

import { useSessionValue } from '@/features/account';
import { useT } from '@/i18n';
import { Download, FileCode, FileText, Icon, LoaderCircle, type LucideIcon } from '@/ui/Icon';

import type { ExportFormat } from './exportNote';
import { useExportProgress } from './ExportProgressContext';

export interface ExportMenuProps {
  onChoose: (format: ExportFormat) => void;
  /** Closes the menu without choosing — Escape, or a click elsewhere. */
  onDismiss: () => void;
}

interface Choice {
  format: ExportFormat;
  label: 'export.markdown' | 'export.html' | 'export.pdf';
  glyph: LucideIcon;
  /** PDF export renders server-side and needs the signed-in session to reach it. */
  disabledWhenSignedOut?: true;
}

const CHOICES: readonly Choice[] = [
  { format: 'md', label: 'export.markdown', glyph: Download },
  { format: 'html', label: 'export.html', glyph: FileCode },
  { format: 'pdf', label: 'export.pdf', glyph: FileText, disabledWhenSignedOut: true },
];

/**
 * The three export destinations, as a menu under the export button.
 *
 * Placement is the parent's job, like every other floating surface in the editor
 * — see `RichEditor`.
 *
 * Focus moves to the first item on open, and Escape returns to the opener. That
 * is not polish: the button that opens this menu is icon-only, so a keyboard user
 * who cannot get into the menu has no route to exporting at all.
 */
export function ExportMenu({ onChoose, onDismiss }: ExportMenuProps): ReactElement {
  const t = useT();
  const { state } = useSessionValue();
  const { pending } = useExportProgress();
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    first.current?.focus();
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
      aria-label={t('export.label')}
      className="flex min-w-40 flex-col gap-0.5 rounded-lg bg-surface p-1 shadow-popover"
    >
      {CHOICES.map((choice, index) => {
        // `busy` is the PDF item specifically: the flag is global (one
        // render can only ever have one PDF in flight from the user's point
        // of view — see `ExportProgressContext`), but Markdown and HTML are
        // synchronous downloads with nothing to be busy about, so they must
        // stay clickable while a PDF renders in the background.
        const busy = choice.format === 'pdf' && pending;
        // `aria-disabled`, not `disabled` the HTML attribute: an HTML-disabled
        // button leaves the tab order, so a keyboard user could never reach
        // it to discover why PDF is off. `aria-disabled` keeps it reachable;
        // `onClick` below refuses the action itself. `busy` reuses the same
        // pattern for the same reason — a user re-clicking PDF mid-render
        // should find out why nothing happens, not lose the control.
        const disabled =
          (choice.disabledWhenSignedOut === true && state.status !== 'signedIn') || busy;

        return (
          <button
            key={choice.format}
            ref={index === 0 ? first : undefined}
            type="button"
            role="menuitem"
            aria-disabled={disabled ? 'true' : undefined}
            aria-busy={busy ? 'true' : undefined}
            onClick={() => {
              if (disabled) return;
              onChoose(choice.format);
            }}
            className={`flex items-center gap-2 rounded-sm px-2 py-1 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear ${disabled ? 'text-faint' : 'text-text hover:bg-hover'}`}
          >
            <span className="text-faint">
              {busy ? (
                <Icon glyph={LoaderCircle} size="sm" className="bear-spin" />
              ) : (
                <Icon glyph={choice.glyph} size="sm" />
              )}
            </span>
            {t(choice.label)}
            {disabled && (
              <span className="sr-only">
                {' '}
                {busy ? t('export.pdf.pending') : t('export.pdf.requiresSignIn')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
