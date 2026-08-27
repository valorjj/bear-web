import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { CalloutMenu } from './CalloutMenu';
import { CALLOUT_TYPES } from './callouts';

describe('CalloutMenu', () => {
  it('marks the active type checked, so the choice is not carried by colour alone', () => {
    renderWithI18n(<CalloutMenu current="warning" onChoose={vi.fn()} onDismiss={vi.fn()} />);

    expect(
      screen.getByRole('menuitemradio', { name: 'Warning', checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemradio', { name: 'Quote', checked: false }),
    ).toBeInTheDocument();
  });

  it('marks the plain quote checked when there is no callout', () => {
    renderWithI18n(<CalloutMenu current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('menuitemradio', { name: 'Quote', checked: true })).toBeInTheDocument();
  });

  it('offers exactly the roster plus a plain quote', () => {
    // Derived from CALLOUT_TYPES rather than listed again, so a sixth type
    // cannot exist in the schema and be missing from the menu.
    renderWithI18n(<CalloutMenu current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(CALLOUT_TYPES.length + 1);
  });

  it.each([
    ['info', 'Info'],
    ['tip', 'Tip'],
    ['success', 'Success'],
    ['warning', 'Warning'],
    ['danger', 'Danger'],
  ])('labels %s through i18n rather than by its marker word', (_type, label) => {
    // Every row goes through `useT`. The marker stays English syntax; the menu
    // is UI, and `ko.ts` is annotated `Record<TranslationKey, string>` so a
    // missing translation is a compile error rather than a blank row.
    renderWithI18n(<CalloutMenu current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('menuitemradio', { name: label })).toBeInTheDocument();
  });

  it('reports the chosen type', async () => {
    const onChoose = vi.fn();
    renderWithI18n(<CalloutMenu current={null} onChoose={onChoose} onDismiss={vi.fn()} />);

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Danger' }));

    expect(onChoose).toHaveBeenCalledWith('danger');
  });

  it('reports null for the plain quote, which is how a callout is undone', () => {
    const onChoose = vi.fn();
    renderWithI18n(<CalloutMenu current="tip" onChoose={onChoose} onDismiss={vi.fn()} />);

    screen.getByRole('menuitemradio', { name: 'Quote' }).click();

    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('focuses the checked item on open', () => {
    // The control that opens this menu is icon-only, so a keyboard user who
    // cannot get in has no route to a callout at all.
    renderWithI18n(<CalloutMenu current="success" onChoose={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('menuitemradio', { name: 'Success' })).toHaveFocus();
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    renderWithI18n(<CalloutMenu current={null} onChoose={vi.fn()} onDismiss={onDismiss} />);

    await userEvent.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalled();
  });
});
