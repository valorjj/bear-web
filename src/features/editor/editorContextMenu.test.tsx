import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { EMPTY_FLAGS } from './editorState';
import { EditorContextMenu } from './EditorContextMenu';

// `I18nProvider` is the real helper — there is no `TestI18nProvider`.
// `locale="en"` is passed explicitly: every assertion below matches on an
// English accessible name.
function renderMenu(overrides: Partial<Parameters<typeof EditorContextMenu>[0]> = {}) {
  const onAction = vi.fn();
  const onSetHeading = vi.fn();
  const onSetHighlight = vi.fn();
  const onClose = vi.fn();
  const props = {
    request: { pos: 0, rect: new DOMRect(10, 10, 0, 0), selection: null },
    flags: EMPTY_FLAGS,
    onAction,
    onSetHeading,
    onSetHighlight,
    onClose,
    ...overrides,
  };
  render(
    <I18nProvider locale="en">
      <EditorContextMenu {...props} />
    </I18nProvider>,
  );
  return { onAction, onSetHeading, onSetHighlight, onClose };
}

describe('EditorContextMenu', () => {
  it('shows no table section when the caret is not in a table', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: false } });
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete table' })).toBeNull();
  });

  it('shows the table section when the caret is in a table', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: true } });
    expect(screen.getByRole('menuitem', { name: 'Insert row above' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete table' })).toBeVisible();
  });

  it('carries no clipboard rows', () => {
    renderMenu();
    for (const name of ['Cut', 'Copy', 'Paste']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
  });

  it('has no nested submenus', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: true } });
    // A nested flyout would necessarily add a second `role="menu"` element;
    // `queryByRole('menuitem', { expanded: false })` alone is weak — it only
    // matches an item carrying an explicit `aria-expanded`, so it would pass
    // against many sabotaged (submenu-bearing) implementations that simply
    // never set that attribute.
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(screen.queryByRole('menuitem', { expanded: false })).toBeNull();
    expect(document.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(0);
  });

  it('reflects active formatting from the flags', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, bold: true } });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Bold' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Italic' })).not.toBeChecked();
  });

  it('reports a format action', async () => {
    const { onAction } = renderMenu();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bold' }));
    expect(onAction).toHaveBeenCalledWith('bold');
  });

  it('checks the heading row matching flags.headingLevel, not just level 1', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, heading1: false, headingLevel: 3 } });
    expect(screen.getByRole('menuitemradio', { name: 'Heading 3' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Heading 1' })).not.toBeChecked();
  });

  it('reports a heading level from the inline row', async () => {
    const { onSetHeading } = renderMenu();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Heading 2' }));
    expect(onSetHeading).toHaveBeenCalledWith(2);
  });

  it('reports paragraph as level 0', async () => {
    const { onSetHeading } = renderMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Body text' }));
    expect(onSetHeading).toHaveBeenCalledWith(0);
  });

  it('closes on Escape', async () => {
    const { onClose } = renderMenu();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('focuses its first item on open', () => {
    renderMenu();
    expect(document.activeElement).toHaveAttribute('role', expect.stringContaining('menuitem'));
  });
});

describe('the Section group', () => {
  it('is absent when the caret is not in a section', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, section: false } });
    expect(screen.queryByRole('group', { name: 'Section' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move section up' })).toBeNull();
  });

  it('offers both moves when the caret is in a section', () => {
    renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: true, sectionDown: true },
    });
    expect(screen.getByRole('menuitem', { name: 'Move section up' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Move section down' })).toBeEnabled();
  });

  it('disables each direction independently at the ends of the document', () => {
    renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: false, sectionDown: true },
    });
    // The FIRST section: nowhere up, somewhere down.
    expect(screen.getByRole('menuitem', { name: 'Move section up' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Move section down' })).toBeEnabled();
  });

  it('reports the action and closes', async () => {
    const user = userEvent.setup();
    const { onAction, onClose } = renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: true, sectionDown: true },
    });

    await user.click(screen.getByRole('menuitem', { name: 'Move section down' }));

    expect(onAction).toHaveBeenCalledWith('moveSectionDown');
    expect(onClose).toHaveBeenCalled();
  });
});
