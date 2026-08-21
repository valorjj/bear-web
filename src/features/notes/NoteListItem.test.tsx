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

describe('pin icon', () => {
  it('renders the pin as an icon and keeps its name', () => {
    renderItem({ note: makeNote({ pinned: false }) });

    const pin = screen.getByRole('button', { name: 'Pin note' });
    expect(pin.querySelector('svg')).not.toBeNull();
    expect(pin.textContent).toBe('');
  });

  it('keeps the pin button a sibling of the row, never nested inside it', () => {
    const { container } = renderItem({ note: makeNote({ pinned: false }) });
    expect(container.querySelector('button button')).toBeNull();
  });
});

describe('accessible name', () => {
  it('separates title, date and snippet so they do not run together', () => {
    // Pre-M7 this announced as "Groceries14:32milk and bread".
    renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nmilk and bread' }),
    });

    const row = screen.getByRole('button', { name: /Groceries/ });
    const name = row.getAttribute('aria-label') ?? '';
    expect(name).toContain('Groceries, ');
    expect(name).toMatch(/, milk and bread$/);
  });

  it('names an untitled, empty note without collapsing the two placeholders', () => {
    renderItem({ note: makeNote({ title: '', text: '' }) });

    const row = screen.getByRole('button', { name: /Untitled/ });
    expect(row.getAttribute('aria-label')).toContain('Untitled, ');
  });

  it('is unaffected by highlight markup', () => {
    renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nmilk and bread' }),
      query: 'milk',
    });

    const row = screen.getByRole('button', { name: /Groceries/ });
    expect(row.getAttribute('aria-label')).toMatch(/, milk and bread$/);
  });
});

describe('query highlighting', () => {
  it('marks the match in the snippet', () => {
    const { container } = renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nmilk and bread' }),
      query: 'milk',
    });

    expect(container.querySelector('[data-match]')?.textContent).toBe('milk');
  });

  it('marks the match in the title', () => {
    const { container } = renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nmilk' }),
      query: 'Groc',
    });

    const marks = [...container.querySelectorAll('[data-match]')];
    expect(marks.map((m) => m.textContent)).toContain('Groc');
  });

  it('shows the matching line as the snippet, not the first line', () => {
    renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nfirst\nmilk here' }),
      query: 'milk',
    });

    // Highlighting splits "milk here" across a marked span and a trailing
    // text node, so the default text matcher — which only reads an
    // element's own direct text-node children — cannot see the whole
    // string as one node's text. Match on the element's full textContent
    // instead of the (reduced) text the default matcher receives.
    expect(screen.getByText((_, node) => node?.textContent === 'milk here')).toBeInTheDocument();
  });

  it('renders nothing marked without a query', () => {
    const { container } = renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries\nmilk' }),
    });

    expect(container.querySelector('[data-match]')).toBeNull();
  });

  // The snippet placeholder is "No additional text" — a query for "text"
  // would otherwise highlight it as though the user had written it.
  it('does not highlight a match inside the "no text" placeholder', () => {
    const { container } = renderItem({
      note: makeNote({ title: 'Groceries', text: 'Groceries' }),
      query: 'text',
    });

    expect(screen.getByText('No additional text')).toBeInTheDocument();
    expect(container.querySelector('[data-match]')).toBeNull();
  });

  // Same mechanism for the title placeholder: "Untitled" itself could match
  // a query for "title" or similar, and must not highlight either.
  it('does not highlight a match inside the "untitled" placeholder', () => {
    const { container } = renderItem({
      note: makeNote({ title: '', text: '' }),
      query: 'untitled',
    });

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(container.querySelector('[data-match]')).toBeNull();
  });
});

describe('preview size', () => {
  it('shows two snippet lines at large, the default', () => {
    const { container } = renderItem();
    expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-2')).not.toBeNull();
  });

  it('shows one snippet line at medium', () => {
    const { container } = renderItem({ size: 'medium' });
    expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-1')).not.toBeNull();
    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });

  it('renders no snippet at small', () => {
    renderItem({ size: 'small' });
    expect(screen.queryByText('milk, bread, coffee')).not.toBeInTheDocument();
  });

  it('drops the snippet from the accessible name at small, so the name matches the row', () => {
    // The date's rendered form is deliberately not pinned here — the sibling
    // tests in 'accessible name' avoid it too, because it varies with locale
    // and with how far the note's date is from `now`. The contract under test
    // is that the snippet is absent, not what the date looks like.
    renderItem({ size: 'small' });

    const name = screen.getByRole('button', { name: /Groceries/ }).getAttribute('aria-label') ?? '';
    expect(name).toContain('Groceries, ');
    expect(name).not.toContain('milk, bread, coffee');
  });

  it('keeps the snippet in the accessible name at medium and large', () => {
    for (const size of ['medium', 'large'] as const) {
      const { unmount } = renderItem({ size });

      const name =
        screen.getByRole('button', { name: /Groceries/ }).getAttribute('aria-label') ?? '';
      expect(name).toMatch(/, milk, bread, coffee$/);
      unmount();
    }
  });

  it('reserves the snippet height at medium, so rows stay uniform', () => {
    const { container } = renderItem({ size: 'medium', note: makeNote({ text: 'Groceries' }) });
    expect(container.querySelector('.line-clamp-1')?.className).toContain('min-h-[1.03125rem]');
  });
});
