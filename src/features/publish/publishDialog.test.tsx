import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { PublishDialog, type PublishedInfo } from './PublishDialog';
import { PublishError } from './requestPublish';

const WHEN = new Date('2026-08-01T12:00:00Z').getTime();
const PAGE: PublishedInfo = { id: 'abc', url: 'https://pub.test/p/abc', publishedAt: WHEN };

function renderDialog(ui: ReactElement): void {
  render(<I18nProvider>{ui}</I18nProvider>);
}

describe('PublishDialog', () => {
  it('shows the url and when it was published', () => {
    renderDialog(<PublishDialog page={PAGE} />);

    expect(screen.getByRole('textbox', { name: 'Published to the web' })).toHaveValue(
      'https://pub.test/p/abc',
    );
    // The snapshot model is only honest if this is visible.
    expect(screen.getByText(/Published /)).toBeInTheDocument();
  });

  it('names the reason when publishing fails', async () => {
    const onPublish = vi.fn(async () => {
      throw new PublishError('offline');
    });
    renderDialog(<PublishDialog onPublish={onPublish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish to web' }));

    expect(await screen.findByText('Publishing needs a connection.')).toBeInTheDocument();
  });

  it('names the limit when the quota is hit', async () => {
    const onPublish = vi.fn(async () => {
      throw new PublishError('quotaExceeded', 50);
    });
    renderDialog(<PublishDialog onPublish={onPublish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish to web' }));

    // The number reaches the user, so a literal {limit} is a defect.
    expect(
      await screen.findByText('You have reached the publishing limit (50).'),
    ).toBeInTheDocument();
  });

  it('routes unpublish through a confirmation', async () => {
    const onUnpublish = vi.fn();
    renderDialog(<PublishDialog page={PAGE} onUnpublish={onUnpublish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));

    expect(onUnpublish).not.toHaveBeenCalled();
    expect(screen.getByText(/The link will stop working immediately/)).toBeInTheDocument();
  });

  it('actually unpublishes once the confirmation is accepted', async () => {
    const onUnpublish = vi.fn(async () => {});
    renderDialog(<PublishDialog page={PAGE} onUnpublish={onUnpublish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    // Two "Unpublish"-named controls exist now: the trigger and the
    // confirmation's own destructive button. The confirmation's is the one
    // inside the alertdialog.
    const confirmDialog = screen.getByRole('alertdialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Unpublish' }));

    expect(onUnpublish).toHaveBeenCalledWith('abc');
    // Back to the not-yet-published view.
    expect(screen.getByRole('button', { name: 'Publish to web' })).toBeInTheDocument();
  });

  it('shows the new url after a successful publish', async () => {
    const onPublish = vi.fn(async () => ({
      id: 'new',
      url: 'https://pub.test/p/new',
      publishedAt: WHEN,
    }));
    renderDialog(<PublishDialog onPublish={onPublish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish to web' }));

    expect(await screen.findByRole('textbox', { name: 'Published to the web' })).toHaveValue(
      'https://pub.test/p/new',
    );
  });
});
