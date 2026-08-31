import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';

import { GraphView } from './GraphView';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteLinks.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderView(onClose = vi.fn(), onOpenNote = vi.fn()) {
  render(
    <I18nProvider locale="en">
      <GraphView activeId={null} onClose={onClose} onOpenNote={onOpenNote} />
    </I18nProvider>,
  );
  return { onClose, onOpenNote };
}

describe('GraphView', () => {
  it('shows the empty state for a vault with no notes', async () => {
    renderView();

    expect(await screen.findByText('No notes to graph')).toBeInTheDocument();
  });

  it('settles a real vault and states the finding in its accessible name', async () => {
    const alpha = await notes.create('# Alpha\n\nlinks to [[Beta]] and [[Nowhere]]');
    await notes.create('# Beta');
    await notes.create('# Lonely');

    renderView();

    // 3 notes + 1 ghost. Asserting the COUNTS, because the whole point of the
    // text alternative is that it carries the finding, not just a role name.
    const canvas = await screen.findByRole('img', { name: /3 notes/ });
    expect(canvas).toHaveAccessibleName(/1 unlinked/);
    expect(canvas).toHaveAccessibleName(/1 link to a note that doesn't exist/);
    expect(alpha.id).toBeTruthy();
  });

  it('lists the ghosts and hubs as real focusable rows', async () => {
    await notes.create('# Alpha\n\n[[Nowhere]]');

    renderView();

    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));

    expect(await screen.findByRole('button', { name: /nowhere/i })).toBeInTheDocument();
  });

  it('closes when its back control is used', async () => {
    await notes.create('# Alpha');

    const { onClose } = renderView();
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Back to notes' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('creates and opens a note when a ghost is chosen', async () => {
    await notes.create('# Alpha\n\n[[Kafka rebalancing]]');

    const { onOpenNote } = renderView();
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    await userEvent.click(await screen.findByRole('button', { name: /kafka rebalancing/i }));

    await waitFor(() => expect(onOpenNote).toHaveBeenCalled());
    const created = await notes.allNoteIndex();
    expect(created.some((n) => n.title.toLowerCase() === 'kafka rebalancing')).toBe(true);
  });
});
