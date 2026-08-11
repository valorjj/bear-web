import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { NoteListItem, type NoteListItemProps } from './NoteListItem';

const NOTE_DATE = new Date(2026, 7, 6, 14, 32).getTime();
const DEFAULT_NOW = new Date(2026, 7, 7).getTime(); // Aug 7, 2026

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

const baseNote = makeNote();

function renderItem(
  overrides: Partial<NoteListItemProps> = {},
  locale?: 'en' | 'ko',
): ReturnType<typeof renderWithI18n> {
  const props: NoteListItemProps = {
    note: baseNote,
    selected: false,
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
    now: DEFAULT_NOW,
    ...overrides,
  };

  return renderWithI18n(<NoteListItem {...props} />, locale);
}

describe('NoteListItem', () => {
  it('shows the title, the snippet, and the date', () => {
    // Pin now to a different day to test the full-date rendering path
    renderItem({ note: makeNote() });

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
    expect(screen.getByText('Aug 6, 2026')).toBeInTheDocument();
  });

  it('renders the time only when the note is from today', () => {
    // Pin now to the same calendar day as the note to test the time-only rendering path
    const now = new Date(2026, 7, 6, 18, 0).getTime(); // Aug 6, 2026, 6:00 PM
    renderItem({ note: makeNote(), now });

    expect(screen.getByText('14:32')).toBeInTheDocument();
  });

  it('falls back to a translated placeholder for an untitled note', () => {
    renderItem({ note: makeNote({ title: '', text: '' }) });

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('No additional text')).toBeInTheDocument();
  });

  it('marks itself as current when selected', () => {
    const { rerender } = renderItem({ note: makeNote(), selected: false });

    expect(screen.getByRole('button', { name: /Groceries/ })).not.toHaveAttribute('aria-current');

    rerender(
      <NoteListItem
        note={makeNote()}
        selected
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        now={DEFAULT_NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /Groceries/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderItem({ note: makeNote(), onSelect });

    await user.click(screen.getByRole('button', { name: /Groceries/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('translates its placeholders', () => {
    renderItem({ note: makeNote({ title: '', text: '' }) }, 'ko');

    expect(screen.getByText('제목 없음')).toBeInTheDocument();
  });

  it('offers a pin control that reports its state', async () => {
    const onTogglePin = vi.fn();
    renderItem({ note: { ...baseNote, pinned: false }, onTogglePin });

    const pin = screen.getByRole('button', { name: 'Pin note' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledWith(baseNote.id, true);
  });

  it('offers to unpin a pinned note', async () => {
    const onTogglePin = vi.fn();
    renderItem({ note: { ...baseNote, pinned: true }, onTogglePin });

    const pin = screen.getByRole('button', { name: 'Unpin note' });
    expect(pin).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledWith(baseNote.id, false);
  });

  it('does not select the note when the pin is clicked', async () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    renderItem({ onSelect, onTogglePin });

    await userEvent.click(screen.getByRole('button', { name: 'Pin note' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
