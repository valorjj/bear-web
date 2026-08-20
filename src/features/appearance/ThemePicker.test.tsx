import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';
import { I18nProvider } from '@/i18n';

import { THEME_KEY } from '@/app/theme';

import { ThemePicker } from './ThemePicker';

function setup() {
  return render(
    <I18nProvider>
      <ThemePicker />
    </I18nProvider>,
  );
}

async function openPicker(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
}

describe('ThemePicker', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    await settings.remove(THEME_KEY);
  });

  it('labels its icon-only trigger', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change theme' })).toBeTruthy();
  });

  it('opens a grouped list of every theme plus System', async () => {
    setup();
    await openPicker();
    expect(screen.getByRole('group', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Dark' })).toBeTruthy();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
  });

  // The group is a property of the roster, not of the palette's luminance.
  it('files High Contrast under Dark', async () => {
    setup();
    await openPicker();
    expect(screen.getByRole('group', { name: 'Dark' }).textContent).toContain('High Contrast');
  });

  it('applies the chosen theme to the document', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Indigo Dark' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('indigo-dark'),
    );
  });

  it('marks the active theme as checked', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paper' }));
    await openPicker();
    expect(screen.getByRole('menuitemradio', { name: 'Paper' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  // System is the ABSENCE of the attribute. A picker writing
  // data-theme="system" would match no block and paint the :root fallback for
  // someone whose OS is dark.
  it('removes the attribute when System is chosen', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ink' }));
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false));
  });

  it('closes after a choice', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paper' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('persists the choice durably', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High Contrast' }));
    await waitFor(async () => {
      expect(await settings.get(THEME_KEY, 'system')).toBe('high-contrast');
    });
  });
});
