import { type ReactElement, useCallback, useEffect, useRef } from 'react';

import { PUBLISH_ORIGIN } from '@/data/sync/config';

import { PublishDialog, type PublishedInfo } from './PublishDialog';
import { listPublished, publishNote, unpublishNote } from './requestPublish';

export interface PublishDialogContainerProps {
  onClose: () => void;
  noteId: string;
  title: string;
  /** Builds the HTML to publish, on demand — never called until the user clicks. */
  buildHtml: () => Promise<string>;
  /**
   * The note's current published page, tracked by the caller across
   * opens/closes. `null` is ambiguous on purpose — it means "not known to be
   * published YET", not "definitely never published": a fresh mount (after a
   * reload, or the first time this note's dialog opens this session) always
   * starts here and looks the note up via `listPublished` below, because the
   * caller has no durable memory of its own.
   */
  page: PublishedInfo | null;
  /** Called after a successful publish, unpublish, or lookup, so the caller's own record stays in sync. */
  onPage: (page: PublishedInfo | null) => void;
}

/**
 * The real wiring `PublishDialog` needs — `publishNote`/`unpublishNote`/
 * `listPublished`, kept out of `PublishDialog` itself so that presentational
 * component stays trivially testable with injected callbacks.
 *
 * This file, `PublishDialog.tsx` and `requestPublish.ts` are the whole cost
 * of publishing: `NoteEditor` reaches this only through `React.lazy`, so none
 * of the three — nor the network request layer — count against the eager
 * bundle. See `scripts/bundleSize.test.ts`.
 */
export function PublishDialogContainer({
  onClose,
  noteId,
  title,
  buildHtml,
  page,
  onPage,
}: PublishDialogContainerProps): ReactElement {
  // A ref, not a dep on `onPage`/`page`: this must run exactly once per
  // mount (this component only exists while the dialog is open, gated by
  // `NoteEditor`'s `publishOpen`), never again just because the caller's
  // state identity changed as a result of the lookup itself.
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;

  /**
   * Recovers a note's published state after a reload, or on the FIRST
   * open this session — `NoteEditor` has no durable memory of its own, so
   * without this a previously-published note reopens the dialog showing
   * "not yet published": no URL, no time, and critically no route to
   * Unpublish until the user republishes it first. `listPublished` lists
   * every one of the signed-in user's published pages; the match by
   * `noteId` is a linear scan client-side because the server has no
   * per-note lookup endpoint, and the list is expected to stay small.
   *
   * Skipped entirely when `page` already has a value: a publish or
   * unpublish just completed in THIS mount already knows better than a
   * fetch would.
   */
  useEffect(() => {
    if (page !== null) return;
    let cancelled = false;

    void listPublished()
      .then((pages) => {
        if (cancelled) return;
        const match = pages.find((candidate) => candidate.noteId === noteId);
        if (match === undefined) return;
        onPageRef.current({
          id: match.id,
          url: `${PUBLISH_ORIGIN}/p/${match.id}`,
          publishedAt: match.publishedAt,
        });
      })
      .catch(() => {
        // No published state recovered is the same as "not yet published" —
        // the dialog's own CTA lets the user try again by publishing.
      });

    return () => {
      cancelled = true;
    };
    // `onPage` deliberately absent from this list — reached only through
    // `onPageRef`, so this effect re-runs when `noteId` or `page` itself
    // changes, never merely because the caller re-created its callback.
  }, [noteId, page]);

  const handlePublish = useCallback(async (): Promise<PublishedInfo> => {
    const html = await buildHtml();
    const result = await publishNote(html, noteId, title);
    onPage(result);
    return result;
  }, [buildHtml, noteId, title, onPage]);

  const handleUnpublish = useCallback(
    async (id: string): Promise<void> => {
      await unpublishNote(id);
      onPage(null);
    },
    [onPage],
  );

  return (
    <PublishDialog
      page={page}
      onPublish={handlePublish}
      onUnpublish={handleUnpublish}
      onClose={onClose}
    />
  );
}

export default PublishDialogContainer;
