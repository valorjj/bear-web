import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { smartScope, tagScope } from './scope';
import { ScopeMenu, type ScopeMenuProps } from './ScopeMenu';

function renderMenu(overrides: Partial<ScopeMenuProps> = {}): void {
  const props: ScopeMenuProps = {
    scope: smartScope('all'),
    count: 33,
    scopeQuery: { order: { field: 'updated', newestFirst: true }, includeDescendants: true },
    previewSize: 'large',
    onOrderChange: vi.fn(),
    onPreviewSizeChange: vi.fn(),
    onIncludeDescendantsChange: vi.fn(),
    onScopeChange: vi.fn(),
    ...overrides,
  };
  renderWithI18n(<ScopeMenu {...props} />);
}

describe('ScopeMenu', () => {
  it('names the count from the unfiltered scope list', () => {
    renderMenu({ count: 33 });
    expect(screen.getByText('33 notes')).toBeInTheDocument();
  });

  it('uses the singular for one note', () => {
    renderMenu({ count: 1 });
    expect(screen.getByText('1 note')).toBeInTheDocument();
  });

  it('marks the active sort field checked, as a radio', () => {
    renderMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Date modified' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Date created' })).not.toBeChecked();
  });

  it('marks the direction toggle as a checkbox', () => {
    renderMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Newest first' })).toBeChecked();
  });

  it('reports a chosen sort field, keeping the current direction', async () => {
    const onOrderChange = vi.fn();
    renderMenu({ onOrderChange });

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Title' }));

    expect(onOrderChange).toHaveBeenCalledWith({ field: 'title', newestFirst: true });
  });

  it('reports a flipped direction, keeping the current field', async () => {
    const onOrderChange = vi.fn();
    renderMenu({ onOrderChange });

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Newest first' }));

    expect(onOrderChange).toHaveBeenCalledWith({ field: 'updated', newestFirst: false });
  });

  it('marks the active preview size checked', () => {
    renderMenu({ previewSize: 'medium' });
    expect(screen.getByRole('menuitemradio', { name: 'Medium' })).toBeChecked();
  });

  it('reports a chosen preview size', async () => {
    const onPreviewSizeChange = vi.fn();
    renderMenu({ onPreviewSizeChange });

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Small' }));

    expect(onPreviewSizeChange).toHaveBeenCalledWith('small');
  });

  it('disables the sort group in Trash and says why', () => {
    renderMenu({ scope: smartScope('trash') });

    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toBeDisabled();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Newest first' })).toBeDisabled();
    expect(screen.getByText('Trash is ordered by when notes were deleted.')).toBeInTheDocument();
  });

  it('leaves the sort group enabled outside Trash', () => {
    renderMenu();

    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toBeEnabled();
    expect(screen.queryByText('Trash is ordered by when notes were deleted.')).toBeNull();
  });

  it('disables the sub-tag toggle outside a tag scope and says why', () => {
    renderMenu({ scope: smartScope('all') });

    expect(screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' })).toBeDisabled();
    expect(screen.getByText('Only tag lists have sub-tags.')).toBeInTheDocument();
  });

  it('enables the sub-tag toggle in a tag scope, checked when descendants are hidden', () => {
    renderMenu({
      scope: tagScope('work'),
      scopeQuery: { order: { field: 'updated', newestFirst: true }, includeDescendants: false },
    });

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' });
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
  });

  it('reports showing descendants again when the sub-tag toggle is unchecked', async () => {
    const onIncludeDescendantsChange = vi.fn();
    renderMenu({
      scope: tagScope('work'),
      scopeQuery: { order: { field: 'updated', newestFirst: true }, includeDescendants: false },
      onIncludeDescendantsChange,
    });

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' }));

    expect(onIncludeDescendantsChange).toHaveBeenCalledWith(true);
  });

  it('reports hiding descendants when the sub-tag toggle is checked', async () => {
    const onIncludeDescendantsChange = vi.fn();
    renderMenu({ scope: tagScope('work'), onIncludeDescendantsChange });

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' }));

    expect(onIncludeDescendantsChange).toHaveBeenCalledWith(false);
  });

  it('lists every smart list, in sidebar order, with its shortcut hint', () => {
    renderMenu();

    // Label and hint asserted as a pair, ignoring the ✓ the active row also
    // draws — the contract is which digit belongs to which list.
    const hints = screen
      .getAllByRole('menuitemradio')
      .map((row) => (row.textContent ?? '').replace('✓', ''))
      .filter((text) => text.includes('⇧⌘'));

    expect(hints).toEqual([
      'Notes⇧⌘1',
      'Untagged⇧⌘2',
      'Todo⇧⌘3',
      'Today⇧⌘4',
      'Pinned⇧⌘5',
      'Locked⇧⌘6',
      'Trash⇧⌘0',
    ]);
  });

  it('marks the current scope checked among the scope rows, and draws it', () => {
    renderMenu({ scope: smartScope('todo') });

    const row = screen.getByRole('menuitemradio', { name: /Todo/ });
    expect(row).toBeChecked();
    // Visible, not only announced: a sighted user must be able to see which
    // list is current without leaving the menu.
    expect(row.textContent).toContain('✓');
  });

  it('checks no scope row when the scope is a tag', () => {
    renderMenu({ scope: tagScope('work') });

    const checkedScopes = screen
      .getAllByRole('menuitemradio')
      .filter((row) => (row.textContent ?? '').includes('⇧⌘'))
      .filter((row) => row.getAttribute('aria-checked') === 'true');

    expect(checkedScopes).toHaveLength(0);
  });

  it('reports a chosen scope', async () => {
    const onScopeChange = vi.fn();
    renderMenu({ onScopeChange });

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pinned/ }));

    expect(onScopeChange).toHaveBeenCalledWith(smartScope('pinned'));
  });

  it('moves focus down the rows with ArrowDown', async () => {
    renderMenu();
    screen.getByRole('menuitemradio', { name: 'Date modified' }).focus();

    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitemradio', { name: 'Date created' })).toHaveFocus();
  });

  it('moves focus up the rows with ArrowUp', async () => {
    renderMenu();
    screen.getByRole('menuitemradio', { name: 'Date created' }).focus();

    await userEvent.keyboard('{ArrowUp}');

    expect(screen.getByRole('menuitemradio', { name: 'Date modified' })).toHaveFocus();
  });

  it('skips disabled rows when moving, so a disabled group is not a dead stop', async () => {
    // In Trash the three sort fields and the direction toggle are disabled, so
    // ArrowDown from the first ENABLED row must reach a preview size.
    renderMenu({ scope: smartScope('trash') });
    screen.getByRole('menuitemradio', { name: 'Small' }).focus();

    await userEvent.keyboard('{ArrowUp}');

    expect(screen.getByRole('menuitemradio', { name: /Trash/ })).toHaveFocus();
  });

  it('wraps from the last row to the first with ArrowDown', async () => {
    renderMenu();
    const rows = screen.getAllByRole('menuitemradio');
    rows[rows.length - 1]!.focus();

    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitemradio', { name: 'Date modified' })).toHaveFocus();
  });

  it('jumps to the last row with End and the first with Home', async () => {
    renderMenu();
    const rows = screen.getAllByRole('menuitemradio');
    rows[0]!.focus();

    await userEvent.keyboard('{End}');
    expect(rows[rows.length - 1]!).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(rows[0]!).toHaveFocus();
  });
});
