import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';
import { I18nProvider } from '@/i18n';

import { THEME_KEY } from '@/app/theme';

import { THEMES } from '@/styles/themes';

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

  /*
   * These assert `radio` inside a `radiogroup`, where they used to assert
   * `menuitemradio` inside a `menu`. That is a deliberate behaviour change,
   * not a stale expectation being edited to match a restyle: the picker was a
   * menu of rows and is now a grid of previews, and one choice is always in
   * effect, which is what radio semantics carry.
   *
   * The light/dark separators are headings rather than nested `role="group"`
   * wrappers, because a `group` sitting between a `radiogroup` and its radios
   * is not a shape ARIA defines.
   */
  it('opens a grid of every theme plus System', async () => {
    setup();
    await openPicker();
    expect(screen.getByRole('heading', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dark' })).toBeTruthy();
    // Derived from the roster, not hardcoded: this read `6` and broke the
    // moment F grew the roster. The count that matters is "every theme, plus
    // System", which is what this says.
    expect(
      within(screen.getByRole('radiogroup', { name: 'Appearance' })).getAllByRole('radio'),
    ).toHaveLength(THEMES.length + 1);
  });

  // The group is a property of the roster, not of the palette's luminance.
  it('files High Contrast under Dark', async () => {
    setup();
    await openPicker();

    const names = screen.getAllByRole('radio').map((el) => el.textContent ?? '');
    const darkIds = THEMES.filter((theme) => theme.group === 'dark').map((theme) => theme.id);
    const firstDark = names.findIndex((text) => text.startsWith('Indigo Dark'));
    const highContrast = names.findIndex((text) => text.startsWith('High Contrast'));

    expect(darkIds).toContain('high-contrast');
    expect(highContrast).toBeGreaterThanOrEqual(firstDark);
  });

  /*
   * The trick the whole component rests on: a card paints itself by being
   * rendered inside its own `data-theme`, so no colour reaches TypeScript. A
   * palette edit updates this picker for free.
   *
   * System deliberately carries NO attribute, inheriting whatever the
   * document currently shows — which is what choosing System means, and is
   * how the app itself represents it.
   */
  /*
   * Each card shows a name, a pangram and an accent line. Without an explicit
   * label all three concatenate into the accessible name and every one of
   * seventeen radios announces the whole sample — the defect class that gave
   * this project "work3" and "Groceries14:32milk". The preview exists to be
   * looked at, so it is hidden from assistive tech.
   */
  it('announces only the theme name, never the preview text', async () => {
    setup();
    await openPicker();

    const nord = screen.getByRole('radio', { name: 'Nord' });
    expect(nord).toHaveAccessibleName('Nord');
    expect(nord.textContent).toContain('quick brown fox');
  });

  it('paints each card in its own theme, and System in none', async () => {
    setup();
    await openPicker();

    expect(screen.getByRole('radio', { name: /Dracula/ })).toHaveAttribute('data-theme', 'dracula');
    expect(screen.getByRole('radio', { name: /System/ })).not.toHaveAttribute('data-theme');
  });

  it('applies the chosen theme to the document', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'Indigo Dark' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('indigo-dark'),
    );
  });

  it('marks the active theme as checked', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'Paper' }));
    await openPicker();
    expect(screen.getByRole('radio', { name: 'Paper' }).getAttribute('aria-checked')).toBe('true');
  });

  // System is the ABSENCE of the attribute. A picker writing
  // data-theme="system" would match no block and paint the :root fallback for
  // someone whose OS is dark.
  it('removes the attribute when System is chosen', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'Ink' }));
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false));
  });

  it('closes after a choice', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'Paper' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('persists the choice durably', async () => {
    setup();
    await openPicker();
    await userEvent.click(screen.getByRole('radio', { name: 'High Contrast' }));
    await waitFor(async () => {
      expect(await settings.get(THEME_KEY, 'system')).toBe('high-contrast');
    });
  });
});
