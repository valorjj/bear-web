import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { NoteListItem } from './NoteListItem';

function makeNote(overrides: Partial<Note> = {}): Note {
  const at = new Date(2026, 7, 6, 14, 32).getTime();
  return {
    id: 'n1',
    title: 'Groceries',
    text: 'Groceries\nmilk, bread, coffee',
    createdAt: at,
    updatedAt: at,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe('NoteListItem', () => {
  it('shows the title, the snippet, and the date', () => {
    renderWithI18n(<NoteListItem note={makeNote()} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
    expect(screen.getByText('Aug 6, 2026')).toBeInTheDocument();
  });

  it('falls back to a translated placeholder for an untitled note', () => {
    renderWithI18n(
      <NoteListItem note={makeNote({ title: '', text: '' })} selected={false} onSelect={vi.fn()} />,
    );

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('No additional text')).toBeInTheDocument();
  });

  it('marks itself as current when selected', () => {
    const { rerender } = renderWithI18n(
      <NoteListItem note={makeNote()} selected={false} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');

    rerender(<NoteListItem note={makeNote()} selected onSelect={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(<NoteListItem note={makeNote()} selected={false} onSelect={onSelect} />);

    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('translates its placeholders', () => {
    renderWithI18n(
      <NoteListItem note={makeNote({ title: '', text: '' })} selected={false} onSelect={vi.fn()} />,
      'ko',
    );

    expect(screen.getByText('제목 없음')).toBeInTheDocument();
  });
});
