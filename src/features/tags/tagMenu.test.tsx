import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { TagRowMenu } from './TagRowMenu';

function mount(onAction = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider>
      <TagRowMenu
        request={{ tag: 'a/b', rect: new DOMRect(10, 20, 0, 0) }}
        onAction={onAction}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onAction, onClose };
}

describe('TagRowMenu', () => {
  it('offers exactly Rename and Delete, as menu items', () => {
    mount();
    expect(screen.getByRole('menu', { name: 'Tag actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename tag',
      'Delete tag',
    ]);
  });

  it.each([
    ['Rename tag', 'rename'],
    ['Delete tag', 'delete'],
  ] as const)('reports %s as %s and closes', async (label, action) => {
    const { onAction, onClose } = mount();
    await userEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(onAction).toHaveBeenCalledWith(action);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('colours only the destructive item', () => {
    mount();
    expect(screen.getByRole('menuitem', { name: 'Delete tag' })).toHaveClass('text-danger');
    expect(screen.getByRole('menuitem', { name: 'Rename tag' })).not.toHaveClass('text-danger');
  });
});
