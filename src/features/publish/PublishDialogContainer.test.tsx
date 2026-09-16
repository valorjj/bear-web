import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PUBLISH_ORIGIN } from '@/data/sync/config';
import { I18nProvider } from '@/i18n';

import { PublishDialogContainer } from './PublishDialogContainer';
import type { PublishedInfo } from './PublishDialog';

const listPublished = vi.fn();
const publishNote = vi.fn();
const isStaleBuild = vi.fn();

vi.mock('./requestPublish', () => ({
  listPublished: (...args: unknown[]) => listPublished(...args),
  publishNote: (...args: unknown[]) => publishNote(...args),
  unpublishNote: vi.fn(),
  // Carries `reason`, unlike a bare `class extends Error`: the dialog's
  // `failureText` switches on it, so a stub without it would render the
  // generic message and this file could not tell one failure from another.
  PublishError: class extends Error {
    readonly reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
    }
  },
}));

vi.mock('./staleBuild', () => ({ isStaleBuild: () => isStaleBuild() }));

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
    publishNote.mockReset();
    isStaleBuild.mockReset();
    isStaleBuild.mockResolvedValue(false);
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

  it('refuses to publish from a stale build, and uploads nothing', async () => {
    /*
     * The failure this exists to stop: `publish` uploads a RENDERED
     * SNAPSHOT, so a tab running superseded code bakes the old stylesheet
     * into a page that then looks wrong until it is republished. It happened
     * three times during sub-project W before anyone noticed the pattern.
     *
     * `publishNote` not being called is the load-bearing assertion. Asserting
     * only the message would pass against a version that warned and uploaded
     * anyway, which is the failure mode worth guarding.
     */
    listPublished.mockResolvedValue([]);
    isStaleBuild.mockResolvedValue(true);

    render(<Host noteId="note-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Publish to web' }));

    expect(await screen.findByText(/Reload before publishing/)).toBeInTheDocument();
    expect(publishNote).not.toHaveBeenCalled();
  });

  it('publishes normally when the build is current', async () => {
    // The other direction, so the guard cannot pass by refusing everything.
    listPublished.mockResolvedValue([]);
    isStaleBuild.mockResolvedValue(false);
    publishNote.mockResolvedValue({
      id: 'new-1',
      url: `${PUBLISH_ORIGIN}/p/new-1`,
      publishedAt: 1_700_000_000_000,
    });

    render(<Host noteId="note-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Publish to web' }));

    expect(await screen.findByRole('textbox', { name: 'Published to the web' })).toHaveValue(
      `${PUBLISH_ORIGIN}/p/new-1`,
    );
    expect(publishNote).toHaveBeenCalledTimes(1);
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
