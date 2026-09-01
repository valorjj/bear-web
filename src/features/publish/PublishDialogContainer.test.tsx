import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PUBLISH_ORIGIN } from '@/data/sync/config';
import { I18nProvider } from '@/i18n';

import { PublishDialogContainer } from './PublishDialogContainer';
import type { PublishedInfo } from './PublishDialog';

const listPublished = vi.fn();

vi.mock('./requestPublish', () => ({
  listPublished: (...args: unknown[]) => listPublished(...args),
  publishNote: vi.fn(),
  unpublishNote: vi.fn(),
  PublishError: class extends Error {},
}));

/**
 * Mirrors how `NoteEditor` actually uses this component: `page` is state
 * the PARENT owns, fed back through `onPage`. A test that passes a no-op
 * `onPage` and a fixed `page` prop would never observe the lookup complete —
 * `PublishDialogContainer` cannot update its own `page`, only report a new
 * one upward.
 */
function Host({
  noteId,
  initialPage = null,
}: {
  noteId: string;
  initialPage?: PublishedInfo | null;
}) {
  const [page, setPage] = useState<PublishedInfo | null>(initialPage);
  return (
    <I18nProvider>
      <PublishDialogContainer
        onClose={() => {}}
        noteId={noteId}
        title="T"
        buildHtml={async () => '<p/>'}
        page={page}
        onPage={setPage}
      />
    </I18nProvider>
  );
}

describe('PublishDialogContainer', () => {
  beforeEach(() => {
    listPublished.mockReset();
  });

  it('shows the published view for a note whose state came from the server, not local state', async () => {
    // No initial page — exactly the shape a fresh mount has after a reload,
    // when `NoteEditor`'s own `publishedPage` state starts at null and has
    // no memory of anything published in a previous session.
    listPublished.mockResolvedValue([
      { id: 'srv-1', noteId: 'note-1', title: 'T', bytes: 10, publishedAt: 1_700_000_000_000 },
      { id: 'other', noteId: 'note-2', title: 'U', bytes: 10, publishedAt: 1 },
    ]);

    render(<Host noteId="note-1" />);

    // The dialog starts in the not-yet-published view, then flips once the
    // lookup resolves — asserting the resolved VALUE, not merely presence.
    expect(await screen.findByRole('textbox', { name: 'Published to the web' })).toHaveValue(
      `${PUBLISH_ORIGIN}/p/srv-1`,
    );
    // And Unpublish is reachable — the whole point: without the lookup this
    // note would show the never-published view with no route to Unpublish.
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
  });

  it('does not call listPublished when the caller already knows the page', () => {
    render(
      <Host
        noteId="note-1"
        initialPage={{ id: 'known', url: 'https://pub.test/p/known', publishedAt: 1 }}
      />,
    );

    expect(listPublished).not.toHaveBeenCalled();
  });

  it('stays on the not-yet-published view when no match is found', async () => {
    listPublished.mockResolvedValue([]);

    render(<Host noteId="note-1" />);

    expect(await screen.findByRole('button', { name: 'Publish to web' })).toBeInTheDocument();
  });
});
