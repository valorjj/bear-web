import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { TagRenamePopover } from './TagRenamePopover';
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

function mountPopover(onSubmit = vi.fn(), existingTags: string[] = ['gemini']) {
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <TagRenamePopover
        tag="a/b"
        rect={new DOMRect(10, 20, 0, 0)}
        existingTags={existingTags}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onSubmit, onClose };
}

describe('TagRenamePopover', () => {
  it('seeds the field with the current name', () => {
    mountPopover();
    expect(screen.getByRole('textbox', { name: 'New tag name' })).toHaveValue('a/b');
  });

  it('submits the normalized name', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    // Mixed case on purpose: tags key lowercase, so the popover must hand
    // down the normalized form rather than what was typed.
    await userEvent.type(field, 'Work/Urgent');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledWith('work/urgent');
  });

  it('blocks a name the grammar cannot write', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    await userEvent.type(field, '.nope');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    expect(screen.getByText(/cannot be used/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('warns about a merge without blocking it', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'gemini');
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledWith('gemini');
  });

  it('calls onClose when Cancel is clicked', async () => {
    const { onClose } = mountPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits on Enter in the field', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'work{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('work');
  });

  it('does not warn about a merge when the name is unchanged', () => {
    mountPopover(vi.fn(), ['a/b']);
    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
  });

  it('allows submitting the unchanged name', async () => {
    const { onSubmit } = mountPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledWith('a/b');
  });
});
