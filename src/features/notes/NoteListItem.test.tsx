import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { NoteListItem } from './NoteListItem';

const NOTE_DATE = new Date(2026, 7, 6, 14, 32).getTime();

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Groceries',
    text: 'Groceries\nmilk, bread, coffee',
    createdAt: NOTE_DATE,
    updatedAt: NOTE_DATE,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe('NoteListItem', () => {
  it('shows the title, the snippet, and the date', () => {
    // Pin now to a different day to test the full-date rendering path
    const now = new Date(2026, 7, 7).getTime(); // Aug 7, 2026
    renderWithI18n(
      <NoteListItem note={makeNote()} selected={false} onSelect={vi.fn()} now={now} />,
    );

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
    expect(screen.getByText('Aug 6, 2026')).toBeInTheDocument();
  });

  it('renders the time only when the note is from today', () => {
    // Pin now to the same calendar day as the note to test the time-only rendering path
    const now = new Date(2026, 7, 6, 18, 0).getTime(); // Aug 6, 2026, 6:00 PM
    renderWithI18n(
      <NoteListItem note={makeNote()} selected={false} onSelect={vi.fn()} now={now} />,
    );

    expect(screen.getByText('14:32')).toBeInTheDocument();
  });

  it('falls back to a translated placeholder for an untitled note', () => {
    const now = new Date(2026, 7, 7).getTime(); // Aug 7, 2026
    renderWithI18n(
      <NoteListItem
        note={makeNote({ title: '', text: '' })}
        selected={false}
        onSelect={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('No additional text')).toBeInTheDocument();
  });

  it('marks itself as current when selected', () => {
    const now = new Date(2026, 7, 7).getTime(); // Aug 7, 2026
    const { rerender } = renderWithI18n(
      <NoteListItem note={makeNote()} selected={false} onSelect={vi.fn()} now={now} />,
    );

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');

    rerender(<NoteListItem note={makeNote()} selected onSelect={vi.fn()} now={now} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const now = new Date(2026, 7, 7).getTime(); // Aug 7, 2026

    renderWithI18n(
      <NoteListItem note={makeNote()} selected={false} onSelect={onSelect} now={now} />,
    );

    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('translates its placeholders', () => {
    const now = new Date(2026, 7, 7).getTime(); // Aug 7, 2026
    renderWithI18n(
      <NoteListItem
        note={makeNote({ title: '', text: '' })}
        selected={false}
        onSelect={vi.fn()}
        now={now}
      />,
      'ko',
    );

    expect(screen.getByText('제목 없음')).toBeInTheDocument();
  });
});
