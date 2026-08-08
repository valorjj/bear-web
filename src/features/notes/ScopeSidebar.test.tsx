import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { ScopeSidebar } from './ScopeSidebar';

describe('ScopeSidebar', () => {
  it('offers exactly the two scopes M3 has', () => {
    renderWithI18n(<ScopeSidebar scope="active" onScopeChange={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument();
  });

  it('marks the active scope as the current page', () => {
    const { rerender } = renderWithI18n(<ScopeSidebar scope="active" onScopeChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Trash' })).not.toHaveAttribute('aria-current');

    rerender(<ScopeSidebar scope="trashed" onScopeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Trash' })).toHaveAttribute('aria-current', 'page');
  });

  it('reports the chosen scope', async () => {
    const onScopeChange = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(<ScopeSidebar scope="active" onScopeChange={onScopeChange} />);
    await user.click(screen.getByRole('button', { name: 'Trash' }));

    expect(onScopeChange).toHaveBeenCalledWith('trashed');
  });
});
