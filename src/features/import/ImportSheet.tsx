import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

import type { SharedPayload } from './parseSharedPage';

export interface ImportSheetProps {
  /** `null` while nothing is offered. */
  payload: SharedPayload | null;
  /** True when the fetch failed or the page carried no payload. */
  failed: boolean;
  /** True while the import is writing. Confirm is disabled, never hidden. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation between a shared link and the user's own notes.
 *
 * It exists because this is OUTSIDE data entering their database — the same
 * reason a destructive action gets a confirmation, from the other direction.
 * **Nothing is written before Confirm.**
 *
 * It names the note and counts its images rather than previewing the body:
 * the reader has just come from a page rendering that body, so repeating it
 * here in a smaller box adds nothing, and a preview of author-supplied
 * Markdown inside the app's own chrome is a surface this does not need.
 *
 * `busy` disables Confirm rather than replacing the sheet with a spinner. The
 * import is a handful of IndexedDB writes; a state that flashes is worse than
 * a button that is briefly inert.
 */
export function ImportSheet({
  payload,
  failed,
  busy,
  onConfirm,
  onCancel,
}: ImportSheetProps): ReactElement | null {
  const t = useT();

  if (payload === null && !failed) return null;

  return (
    <Dialog open onClose={onCancel} label={failed ? t('import.failed') : t('import.title')}>
      <div className="flex flex-col gap-4 p-4">
        {failed || payload === null ? (
          <p className="text-ui text-text">{t('import.failed')}</p>
        ) : (
          <>
            <p className="text-ui-md font-semibold text-text">
              {payload.title === '' ? t('note.untitled') : payload.title}
            </p>
            <p className="text-ui-sm text-muted">{t('import.body')}</p>
            {payload.images.length > 0 && (
              <p className="text-ui-sm text-muted">
                {/* `useT` is `(key) => string` and takes NO interpolation
                    argument — every placeholder in this app is substituted at
                    the call site with `.replace`, as `PublishDialog` does for
                    `{limit}` and `{when}`. */}
                {t('import.images').replace('{count}', String(payload.images.length))}
              </p>
            )}
            {payload.skipped > 0 && (
              <p className="text-ui-sm text-muted">
                {t('import.skipped').replace('{count}', String(payload.skipped))}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('import.cancel')}
          </Button>
          {!failed && payload !== null && (
            <Button onClick={onConfirm} disabled={busy}>
              {t('import.confirm')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
