import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { NoteList, type NoteListProps } from './NoteList';
import { ACTIVE_SCOPE, TRASHED_SCOPE } from './scope';

function makeNote(id: string, title: string): Note {
  return {
    id,
    title,
    text: `${title}\nbody of ${title}`,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
}

function props(overrides: Partial<NoteListProps> = {}): NoteListProps {
  return {
    scope: ACTIVE_SCOPE,
    items: [makeNote('a', 'Alpha'), makeNote('b', 'Beta')],
    selectedNoteId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onTrash: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  };
}

describe('NoteList', () => {
  it('renders one row per note, in the order given', () => {
    renderWithI18n(<NoteList {...props()} />);

    const titles = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(titles[0]).toContain('Alpha');
    expect(titles[1]).toContain('Beta');
  });

  it('reports the id of the clicked note', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(<NoteList {...props({ onSelect })} />);
    await user.click(screen.getByRole('button', { name: /Beta/ }));

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('renders nothing but the header while the query is loading', () => {
    renderWithI18n(<NoteList {...props({ items: undefined })} />);

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText('No notes')).not.toBeInTheDocument();
  });

  it('shows the notes empty state when the active scope has no notes', () => {
    renderWithI18n(<NoteList {...props({ items: [] })} />);

    expect(screen.getByText('No notes')).toBeInTheDocument();
  });

  it('shows the trash empty state when the trashed scope has no notes', () => {
    renderWithI18n(<NoteList {...props({ scope: TRASHED_SCOPE, items: [] })} />);

    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
  });

  it('always offers to create a note', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(<NoteList {...props({ scope: TRASHED_SCOPE, onCreate })} />);
    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('offers delete only for a selected note in the active scope', async () => {
    const onTrash = vi.fn();
    const user = userEvent.setup();

    const { rerender } = renderWithI18n(<NoteList {...props()} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    rerender(<NoteList {...props({ selectedNoteId: 'a', onTrash })} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onTrash).toHaveBeenCalledWith('a');
  });

  it('offers restore instead of delete in the trashed scope', async () => {
    const onRestore = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(
      <NoteList {...props({ scope: TRASHED_SCOPE, selectedNoteId: 'a', onRestore })} />,
    );

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onRestore).toHaveBeenCalledWith('a');
  });
});
