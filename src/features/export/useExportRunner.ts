import { useCallback, useState } from 'react';

import { useLocale, type TranslationKey } from '@/i18n';

import { exportNote, type ExportableNote, type ExportFormat } from './exportNote';
import { useExportProgress } from './ExportProgressContext';
import { PdfExportError, type PdfFailure } from './requestPdf';

/**
 * Every `PdfFailure` reason but `failed` gets its own sentence — a user with
 * no connectivity and a user whose session expired need different copy, and
 * a single "export failed" tells neither of them anything they can act on.
 * `failed` itself is the generic "something else went wrong" case and is
 * deliberately absent here, falling through to `export.failed` exactly as an
 * unrecognised reason does.
 */
const EXPORT_FAILURE_KEYS: Partial<Record<PdfFailure, TranslationKey>> = {
  offline: 'export.failed.offline',
  unauthorized: 'export.failed.unauthorized',
  tooLarge: 'export.failed.tooLarge',
  rateLimited: 'export.failed.rateLimited',
  unavailable: 'export.failed.unavailable',
};

export interface ExportRunner {
  /** Starts an export. Never rejects — a failure lands in `failureKey`. */
  run: (note: ExportableNote, format: ExportFormat) => void;
  /** The i18n key for the last failure, or `null`. */
  failureKey: TranslationKey | null;
}

/**
 * Running an export and reporting how it went, shared by the two places that
 * can start one: the editor's own export button and the note list's row menu.
 *
 * Extracted when the row menu arrived. The alternative was a second copy of
 * the progress pairing and the failure-reason table — and the pairing in
 * particular is the kind of thing that is wrong in exactly one of two copies:
 * `begin()`/`end()` MUST be paired through `finally`, not merely after the
 * `await`, because `exportNote` can reject at any of several points
 * (`renderNoteHtml` throwing synchronously, `requestPdf`'s six failure
 * reasons, `downloadBlob` itself throwing) and every one of them has to clear
 * the flag or the top bar spins forever and the PDF menu item stays
 * `aria-busy` permanently — worse than shipping no loader at all.
 *
 * Only PDF gets the global "busy" signal; Markdown and HTML are synchronous
 * downloads.
 */
export function useExportRunner(): ExportRunner {
  const { locale } = useLocale();
  const { begin, end } = useExportProgress();
  const [failureKey, setFailureKey] = useState<TranslationKey | null>(null);

  const run = useCallback(
    (note: ExportableNote, format: ExportFormat): void => {
      const go = async (): Promise<void> => {
        if (format === 'pdf') begin();
        try {
          setFailureKey(null);
          await exportNote(note, format, locale);
        } catch (error) {
          const reason = error instanceof PdfExportError ? error.reason : 'failed';
          setFailureKey(EXPORT_FAILURE_KEYS[reason] ?? 'export.failed');
        } finally {
          if (format === 'pdf') end();
        }
      };

      void go();
    },
    [locale, begin, end],
  );

  return { run, failureKey };
}
