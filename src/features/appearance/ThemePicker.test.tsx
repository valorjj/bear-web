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

  /*
   * This asserted `data-theme` on the RADIO until the frame fix moved the
   * boundary inward. That is a deliberate contract change, not an expectation
   * bent to match new output: the radio is now app-themed chrome and the
   * preview inside it is the only element that paints itself. See the
   * `theme card framing` block below for why, and `ThemeDialog`'s docblock
   * for the measurements.
   */
  it('paints each card in its own theme, and System in none', async () => {
    setup();
    await openPicker();

    const dracula = screen.getByRole('radio', { name: /Dracula/ });
    expect(dracula).not.toHaveAttribute('data-theme');
    expect(dracula.querySelector('[data-theme="dracula"]')).not.toBeNull();

    expect(screen.getByRole('radio', { name: /System/ }).querySelector('[data-theme]')).toBeNull();
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

/*
 * The frame around a card must be drawn in the APP's palette, not the card's.
 *
 * Until this was fixed, the card was one element carrying `data-theme`, its
 * own background AND its own border — so the line meant to separate it from
 * the dialog panel resolved in the card's theme while the panel resolved in
 * the app's, and nothing made the two contrast. Measured across all 240
 * (app theme x card theme) pairs: 52 had the card's fill within 1.10 of the
 * panel, 34 had the card's border within 1.20 of it, and 4 had both — the
 * card was invisible. A user hit `solarized-light` panel with the `paper`
 * card (fill 1.08, edge 1.20) and reported it.
 *
 * Pinning the dialog to a fixed theme cannot fix this: the roster runs from
 * `paper` (pure white) to `high-contrast` (pure black), so no single panel
 * colour contrasts with every card. Only a per-card frame outside the
 * `data-theme` boundary can, which is what these assertions pin.
 */
describe('theme card framing', () => {
  it('keeps data-theme off the radio itself, so the frame resolves in the app palette', async () => {
    setup();
    await openPicker();

    const nord = screen.getByRole('radio', { name: 'Nord' });
    expect(nord.getAttribute('data-theme'), 'the radio must not carry the theme').toBeNull();

    // The preview is a descendant, and it is what paints itself.
    const preview = nord.querySelector('[data-theme="nord"]');
    expect(preview, 'no themed preview inside the card').not.toBeNull();
  });

  it('names each card by its theme alone, with the sample hidden', async () => {
    setup();
    await openPicker();
    // Regression guard for the concatenated-name defect the card's own
    // comment records: the preview text must stay out of the accessible name.
    expect(screen.getByRole('radio', { name: 'Nord' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /quick brown fox/ })).toBeNull();
  });
});
