import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { ACTIVE_SCOPE, smartScope, tagScope } from './scope';
import { SmartListSidebar } from './SmartListSidebar';

const counts = {
  all: 3,
  untagged: 1,
  todo: 2,
  today: 0,
  pinned: 0,
  locked: 0,
  trash: 4,
};

describe('SmartListSidebar', () => {
  it('renders every list in spec order', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={counts} />,
    );

    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Notes 3',
      'Untagged 1',
      'Todo 2',
      'Today 0',
      'Pinned 0',
      'Locked 0',
      'Trash 4',
    ]);
  });

  it('marks the selected list', () => {
    renderWithI18n(
      <SmartListSidebar scope={smartScope('todo')} onScopeChange={vi.fn()} counts={counts} />,
    );

    expect(screen.getByRole('button', { name: 'Todo 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Notes 3' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when a tag scope is active', () => {
    renderWithI18n(
      <SmartListSidebar scope={tagScope('work')} onScopeChange={vi.fn()} counts={counts} />,
    );

    for (const row of screen.getAllByRole('button')) {
      expect(row).not.toHaveAttribute('aria-current');
    }
  });

  it('changes scope on click', async () => {
    const onScopeChange = vi.fn();
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={onScopeChange} counts={counts} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Trash 4' }));
    expect(onScopeChange).toHaveBeenCalledWith(smartScope('trash'));
  });

  it('renders a zero count rather than omitting it', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={counts} />,
    );

    // "Today 0" must read as zero, not as an unknown quantity.
    expect(screen.getByRole('button', { name: 'Today 0' })).toBeInTheDocument();
  });

  it('renders rows without counts while they are loading', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={undefined} />,
    );

    // The rows themselves must still render — the sidebar structure is not
    // waiting on a number — but no count element may appear.
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-count]')).toHaveLength(0);
  });
});
