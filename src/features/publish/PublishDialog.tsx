import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useLocale, useT } from '@/i18n';

import { PublishError, type PublishFailure } from './requestPublish';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
}

/**
 * A minimal stand-in for `@/ui/Dialog` — backdrop, Escape, initial focus and
 * restore-on-close — deliberately NOT that component. Rendering both this
 * dialog and its unpublish confirmation through the shared `Dialog` (or
 * `ConfirmDialog`, which itself renders one) adds a THIRD crossing consumer
 * to a module `AppShell` and `CommandPalette` already share, which tips
 * Rolldown's chunk-splitting heuristic into extracting a new shared chunk
 * that lands in the EAGER closure regardless of which side of the
 * `React.lazy` boundary imported it — measured at **+1,741 B** for the split
 * alone, against 455 B of headroom. Duplicating this much markup here costs
 * nothing against that ceiling, because this whole file is behind the
 * boundary. It does not reproduce `Dialog`'s Tab-wrap cycling; that gap is
 * recorded rather than silently accepted.
 */
function Modal({
  open,
  onClose,
  role = 'dialog',
  label,
  labelledBy,
  describedBy,
  children,
}: ModalProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="ease-bear bg-text absolute inset-0 opacity-20 transition-opacity duration-[var(--bear-duration)]"
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="bg-bg shadow-dialog relative z-10 mx-4 flex w-full max-w-sm flex-col gap-4 rounded-lg p-6"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The slice of `PublishedPage` this dialog actually needs. Kept narrower than
 * the server record on purpose: a caller reaching in from `NoteEditor` has to
 * assemble a `noteId`/`title`/`bytes` it does not otherwise track just to
 * satisfy a wider type, for fields this component never reads.
 */
export interface PublishedInfo {
  id: string;
  url: string;
  publishedAt: number;
}

export interface PublishDialogProps {
  open?: boolean;
  onClose?: () => void;
  /** The note's current published page, or `null`/omitted if never published. */
  page?: PublishedInfo | null;
  /**
   * Publishes (or republishes) the note and resolves with the new record.
   * Real usage supplies a closure that builds the HTML (via `renderNoteHtml`,
   * the same pipeline HTML export uses) and calls `publishNote` — kept out of
   * this component so the network call and the export pipeline both stay
   * behind this dialog's own `React.lazy` boundary rather than adding to it.
   */
  onPublish?: () => Promise<PublishedInfo>;
  /** Unpublishes the page with the given id. */
  onUnpublish?: (id: string) => Promise<void>;
}

/**
 * Only `offline` and `quotaExceeded` get their own sentence — the two tested
 * cases, and the two a user can act on differently (reconnect, or stop and
 * wait for quota to free up). `unauthorized` reuses `publish.requiresSignIn`,
 * the same sentence the export menu already shows for a signed-out user.
 * Every other reason (`tooLarge`, `rateLimited`, `unavailable`, `failed`)
 * falls through to the generic `publish.failed` — a byte budget this tight
 * (455 B of headroom before this feature) does not afford a sentence per
 * cause when the user's next move is the same "try again" either way.
 */
function failureText(t: ReturnType<typeof useT>, reason: PublishFailure, limit?: number): string {
  if (reason === 'unauthorized') return t('publish.requiresSignIn');
  if (reason === 'quotaExceeded') {
    return t('publish.failed.quotaExceeded').replace('{limit}', String(limit ?? ''));
  }
  if (reason === 'offline') return t('publish.failed.offline');
  return t('publish.failed');
}

/**
 * Plain, unstyled-component buttons rather than `@/ui/Button`, for the same
 * reason `Modal` above stands in for `@/ui/Dialog`: adding this file as a
 * third crossing consumer of an already-shared module tips Rolldown into
 * extracting it into its own chunk, which lands in the eager closure
 * regardless of which side of the `React.lazy` boundary asked for it. The
 * classes below are copied from `Button`'s `default`/`danger` variants so
 * this still looks identical.
 */
const BASE_BUTTON =
  'inline-flex shrink-0 items-center justify-center gap-1.5 h-7 px-2 rounded-sm text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear disabled:pointer-events-none disabled:opacity-40';
const DEFAULT_BUTTON = `${BASE_BUTTON} border border-border bg-bg text-text hover:bg-hover`;
const DANGER_BUTTON = `${BASE_BUTTON} bg-danger text-bg hover:opacity-90`;

/**
 * The publish dialog: not-yet-published shows one button; published shows
 * the link, when it went out, and the two actions on it.
 *
 * The snapshot model is why the published-at time is always on screen, never
 * behind a click — a reader sees the note as it was at THAT moment, and a
 * user who forgets that and assumes an edit is already live has no other cue
 * telling them otherwise.
 *
 * Unpublish is guarded by a confirmation shaped exactly like this app's
 * `ConfirmDialog` — a second modal rendered as an `alertdialog` — but built
 * from the local `Modal` rather than importing that component; see `Modal`'s
 * own doc comment for why.
 */
export function PublishDialog({
  open = true,
  onClose = () => {},
  page = null,
  onPublish,
  onUnpublish,
}: PublishDialogProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const confirmTitleId = useId();
  const confirmBodyId = useId();

  const [current, setCurrent] = useState<PublishedInfo | null>(page ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ reason: PublishFailure; limit?: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handlePublish = async (): Promise<void> => {
    if (onPublish === undefined) return;
    setPending(true);
    setError(null);
    try {
      const result = await onPublish();
      setCurrent(result);
    } catch (thrown) {
      setError(
        thrown instanceof PublishError
          ? { reason: thrown.reason, limit: thrown.limit }
          : { reason: 'failed' },
      );
    } finally {
      setPending(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    setConfirming(false);
    if (current === null || onUnpublish === undefined) return;
    await onUnpublish(current.id);
    setCurrent(null);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} label={t('publish.title')}>
        {current === null ? (
          <button
            type="button"
            className={DEFAULT_BUTTON}
            disabled={pending}
            aria-busy={pending ? 'true' : undefined}
            onClick={() => void handlePublish()}
          >
            {t('publish.open')}
          </button>
        ) : (
          <>
            {/* No separate copy button or "Copied" feedback — `autoFocus` plus
                selecting on focus is enough to copy from a readonly field, and
                a whole extra i18n key pair costs more than this dialog's
                remaining byte budget affords. */}
            <input
              readOnly
              autoFocus
              aria-label={t('publish.title')}
              value={current.url}
              onFocus={(event) => event.currentTarget.select()}
              className="border-border bg-hover text-text text-ui rounded-sm border px-2 py-1"
            />
            <p className="text-ui-sm text-muted">
              {t('publish.publishedAt').replace(
                '{when}',
                new Date(current.publishedAt).toLocaleString(locale),
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={DEFAULT_BUTTON}
                disabled={pending}
                aria-busy={pending ? 'true' : undefined}
                onClick={() => void handlePublish()}
              >
                {t('publish.open')}
              </button>
              <button type="button" className={DANGER_BUTTON} onClick={() => setConfirming(true)}>
                {t('publish.unpublish')}
              </button>
            </div>
          </>
        )}

        {error !== null && (
          <p role="status" className="text-ui-sm text-danger">
            {failureText(t, error.reason, error.limit)}
          </p>
        )}
      </Modal>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        role="alertdialog"
        labelledBy={confirmTitleId}
        describedBy={confirmBodyId}
      >
        <h2 id={confirmTitleId} className="text-ui-lg text-text font-semibold">
          {t('publish.unpublish')}
        </h2>
        <p id={confirmBodyId} className="text-ui text-muted">
          {t('publish.unpublish.confirm')}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={DEFAULT_BUTTON} onClick={() => setConfirming(false)}>
            {t('confirm.cancel')}
          </button>
          <button type="button" className={DANGER_BUTTON} onClick={() => void handleUnpublish()}>
            {t('publish.unpublish')}
          </button>
        </div>
      </Modal>
    </>
  );
}

export default PublishDialog;
