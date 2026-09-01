import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useLocale, useT } from '@/i18n';

import { PublishError, type PublishFailure } from './requestPublish';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Which `Modal` instance owns Escape, while more than one is open at once.
 *
 * Both this dialog and its unpublish confirmation are `Modal`s, and each
 * registers its own document-level `keydown` listener — plain DOM listeners
 * on the same target fire in registration order regardless of
 * `stopPropagation` (that only stops bubbling BETWEEN elements, and both
 * listeners sit on `document` itself), so without this an Escape pressed
 * while the confirmation is open reaches BOTH listeners and closes both
 * modals at once. Each open `Modal` pushes its own id here and only acts on
 * Escape while it is the topmost one; closing pops it back off.
 */
const modalStack: symbol[] = [];

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
 * A minimal stand-in for `@/ui/Dialog` — backdrop, Escape, Tab-trapped focus
 * and restore-on-close — deliberately NOT that component. Rendering both
 * this dialog and its unpublish confirmation through the shared `Dialog` (or
 * `ConfirmDialog`, which itself renders one) adds a THIRD crossing consumer
 * to a module `AppShell` and `CommandPalette` already share, which tips
 * Rolldown's chunk-splitting heuristic into extracting a new shared chunk
 * that lands in the EAGER closure regardless of which side of the
 * `React.lazy` boundary imported it — measured at **+773 B** for the split
 * alone, against 455 B of headroom (a figure corrected from an earlier,
 * stale ×2.2 overestimate). Duplicating this much markup here costs nothing
 * against that ceiling, because this whole file is behind the boundary. The
 * Tab-wrap branch below is copied verbatim from `Dialog`'s own — pasting it
 * in measured +6 B, so there was never a real trade-off between bytes and a
 * keyboard user being able to Tab out of an open modal.
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
  const idRef = useRef<symbol>(Symbol());

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
    const id = idRef.current;
    modalStack.push(id);
    return () => {
      const index = modalStack.indexOf(id);
      if (index !== -1) modalStack.splice(index, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Only the topmost modal reacts — see `modalStack`'s own comment.
      if (modalStack[modalStack.length - 1] !== idRef.current) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable === undefined || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Wrapping in both directions is what makes this a trap rather than a
      // suggestion: without it, Tab walks out into the page behind the modal.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
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
 * `offline`, `quotaExceeded` and `tooLarge` get their own sentence.
 * `unauthorized` reuses `publish.requiresSignIn`, the same sentence the
 * export menu already shows for a signed-out user. `rateLimited` and
 * `unavailable` collapse into the generic `publish.failed`: both genuinely
 * read as "try again", and a byte budget this tight does not afford a
 * sentence per cause when the user's next move is identical either way.
 * `tooLarge` does NOT collapse with them — "this note could not be
 * published" gives a user with an oversized note no next action, where
 * "too large" tells them to remove images.
 */
function failureText(t: ReturnType<typeof useT>, reason: PublishFailure, limit?: number): string {
  if (reason === 'unauthorized') return t('publish.requiresSignIn');
  if (reason === 'quotaExceeded') {
    return t('publish.failed.quotaExceeded').replace('{limit}', String(limit ?? ''));
  }
  if (reason === 'tooLarge') return t('publish.failed.tooLarge');
  if (reason === 'offline') return t('publish.failed.offline');
  return t('publish.failed');
}

/**
 * Plain, unstyled-component buttons rather than `@/ui/Button`, for the same
 * reason `Modal` above stands in for `@/ui/Dialog`: adding this file as a
 * third crossing consumer of an already-shared module tips Rolldown into
 * extracting it into its own chunk, which lands in the eager closure
 * regardless of which side of the `React.lazy` boundary asked for it —
 * measured at +773 B for reusing `Dialog`/`ConfirmDialog`/`Button`. `h-7`,
 * the base layout utilities and the `default`/`danger` colour classes below
 * are copied verbatim from `Button`'s own `md` size and variants. The icon
 * gap `Button` puts between a glyph and its label is deliberately absent —
 * `Button.tsx` carries no such spacing on this size at all, and these
 * buttons hold text only, no icon, so there is nothing for a gap to
 * separate. `touch-target` IS included: J2a's rule that every control gets
 * a 44px hit area on a coarse pointer, which `NEEDS_TOUCH_TARGET` applies to
 * this exact size in `Button` and which a hand-copy must apply for itself.
 */
const BASE_BUTTON =
  'touch-target inline-flex shrink-0 items-center justify-center h-7 px-2 rounded-sm text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear disabled:pointer-events-none disabled:opacity-40';
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

  // Resyncs when the CALLER learns something this component did not already
  // know — specifically `PublishDialogContainer`'s post-mount
  // `listPublished` recovery, which updates its own `page` state only after
  // this component has already mounted with `page` still `null`. A plain
  // `useState` initializer reads its argument exactly once; without this
  // effect, a page recovered after a reload would update the CONTAINER's
  // state and re-render this component with a new `page` prop that this
  // component's own `current` state would never notice.
  useEffect(() => {
    if (page !== null) setCurrent(page);
  }, [page]);
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
    setError(null);
    try {
      await onUnpublish(current.id);
      setCurrent(null);
    } catch (thrown) {
      // `setCurrent` is deliberately never reached here: the dialog stays on
      // the published view with Unpublish still offered, so a failed
      // revocation never LOOKS like a successful one. Unpublish is the only
      // revocation this capability-URL design has, so silence on failure
      // would leave a user unsure whether the link is dead — mirrors
      // `handlePublish`'s error handling immediately above.
      setError(
        thrown instanceof PublishError
          ? { reason: thrown.reason, limit: thrown.limit }
          : { reason: 'failed' },
      );
    }
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
