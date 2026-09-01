import { type ReactElement, useCallback } from 'react';

import { PublishDialog, type PublishedInfo } from './PublishDialog';
import { publishNote, unpublishNote } from './requestPublish';

export interface PublishDialogContainerProps {
  onClose: () => void;
  noteId: string;
  title: string;
  /** Builds the HTML to publish, on demand — never called until the user clicks. */
  buildHtml: () => Promise<string>;
  /** The note's current published page, tracked by the caller across opens/closes. */
  page: PublishedInfo | null;
  /** Called after a successful publish or unpublish, so the caller's own record stays in sync. */
  onPage: (page: PublishedInfo | null) => void;
}

/**
 * The real wiring `PublishDialog` needs — `publishNote`/`unpublishNote`,
 * kept out of `PublishDialog` itself so that presentational component stays
 * trivially testable with injected callbacks.
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
