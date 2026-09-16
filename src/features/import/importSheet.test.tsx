import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { ImportSheet } from './ImportSheet';
import type { SharedPayload } from './parseSharedPage';

function renderSheet(props: Partial<React.ComponentProps<typeof ImportSheet>> = {}) {
  const payload: SharedPayload = { title: 'Shared', text: 'Shared\n', images: [], skipped: 0 };
  const merged = {
    payload,
    failed: false,
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  };
  render(
    <I18nProvider>
      <ImportSheet {...merged} />
    </I18nProvider>,
  );
  return merged;
}

describe('ImportSheet', () => {
  it('renders nothing when nothing is offered', () => {
    render(
      <I18nProvider>
        <ImportSheet
          payload={null}
          failed={false}
          busy={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the note it is offering', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Add this note/);
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('shows the title the write path will actually use, not the payload’s own', () => {
    // `importNote` never reads `payload.title` — `notes.create` derives the
    // title from `text` alone. The confirmation sheet's whole job is telling
    // the user what they are about to accept, so it must show what will
    // really be written, not an attacker-controlled string riding along in
    // the payload.
    renderSheet({
      payload: {
        title: 'Attacker-chosen title',
        text: 'Real first line\nbody',
        images: [],
        skipped: 0,
      },
    });

    expect(screen.getByText('Real first line')).toBeInTheDocument();
    expect(screen.queryByText('Attacker-chosen title')).toBeNull();
  });

  it('says how many images are coming', () => {
    renderSheet({
      payload: {
        title: 'Shared',
        text: 'Shared\n',
        images: [
          { path: 'files/a.webp', blob: new Blob(['a']) },
          { path: 'files/b.webp', blob: new Blob(['b']) },
        ],
        skipped: 0,
      },
    });

    expect(screen.getByText('2 images')).toBeInTheDocument();
  });

  it('says so when images could not be read', () => {
    renderSheet({
      payload: { title: 'Shared', text: 'Shared\n', images: [], skipped: 3 },
    });

    expect(screen.getByText(/3 images could not be read/)).toBeInTheDocument();
  });

  it('confirms on the confirm button and not before', async () => {
    const props = renderSheet();

    expect(props.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels on the cancel button', async () => {
    const props = renderSheet();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables confirm while the import is running', () => {
    renderSheet({ busy: true });
    expect(screen.getByRole('button', { name: 'Add to my notes' })).toBeDisabled();
  });

  it('reports a failure instead of offering an import', () => {
    renderSheet({ payload: null, failed: true });

    expect(screen.getByText('This note could not be added.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to my notes' })).toBeNull();
  });
});
