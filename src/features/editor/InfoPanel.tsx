import type { ReactElement } from 'react';

import { useLocale, useT } from '@/i18n';

import { formatNoteDate } from '../notes/format';

export interface InfoPanelProps {
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Pinned for tests; production callers omit it and get `Date.now()`. */
  now?: number;
}

/** Counts are derived from the plain text, so Markdown syntax is not counted. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function InfoPanel({ text, createdAt, updatedAt, now }: InfoPanelProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const resolvedNow = now ?? Date.now();

  return (
    // A floating popover rather than a bar in the flow: the control that opens
    // it now floats too, and a full-width strip appearing under a floating pill
    // reads as a second, unrelated piece of chrome. Placed by `RichEditor`.
    <dl className="flex shrink-0 items-center gap-6 rounded-lg bg-surface px-4 py-2 text-ui-sm text-faint shadow-popover">
      <div className="flex gap-2">
        <dt>{t('editor.info.words')}</dt>
        <dd className="text-text">{countWords(text)}</dd>
      </div>
      <div className="flex gap-2">
        <dt>{t('editor.info.characters')}</dt>
        <dd className="text-text">{text.length}</dd>
      </div>
      <div className="flex gap-2">
        <dt>{t('editor.info.created')}</dt>
        <dd className="text-text">{formatNoteDate(createdAt, locale, resolvedNow)}</dd>
      </div>
      <div className="flex gap-2">
        <dt>{t('editor.info.modified')}</dt>
        <dd className="text-text">{formatNoteDate(updatedAt, locale, resolvedNow)}</dd>
      </div>
    </dl>
  );
}
