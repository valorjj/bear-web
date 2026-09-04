import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settings } from '@/data';
import { I18nProvider, LOCALE_KEY, LOCALE_MIRROR_KEY } from '@/i18n';

import { LanguageToggle } from './LanguageToggle';

function setup(locale?: 'en' | 'ko') {
  return render(
    <I18nProvider locale={locale}>
      <LanguageToggle />
    </I18nProvider>,
  );
}

describe('LanguageToggle', () => {
  beforeEach(async () => {
    localStorage.clear();
    await settings.remove(LOCALE_KEY);
  });

  /*
   * ONE key, and it always means "switch to the other language" — so the
   * English bundle says "Switch to Korean" and the Korean bundle says the
   * reverse. Two keys would let the two bundles drift into disagreeing about
   * which direction the button goes.
   */
  it('names itself by the language it switches TO', () => {
    setup('en');
    expect(screen.getByRole('button', { name: 'Switch to Korean' })).toBeTruthy();
  });

  it('names itself in Korean when Korean is active', () => {
    setup('ko');
    expect(screen.getByRole('button', { name: 'English로 전환' })).toBeTruthy();
  });

  it('switches the language it is rendered in', async () => {
    setup('en');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Korean' }));
    expect(screen.getByRole('button', { name: 'English로 전환' })).toBeTruthy();
  });

  /*
   * Both halves, because they fail differently. Without the mirror the choice
   * is lost on reload; without the settings row it is lost when site data is
   * cleared and there is no durable record at all.
   */
  it('persists to the mirror and to the settings table', async () => {
    setup('en');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Korean' }));

    expect(localStorage.getItem(LOCALE_MIRROR_KEY)).toBe('ko');
    await waitFor(async () => {
      expect(await settings.get<unknown>(LOCALE_KEY, null)).toBe('ko');
    });
  });

  it('recovers a stored choice when the mirror is absent', async () => {
    await settings.set(LOCALE_KEY, 'ko');
    setup();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'English로 전환' })).toBeTruthy();
    });
    // Recovering also refills the cache, so the next launch needs no read.
    expect(localStorage.getItem(LOCALE_MIRROR_KEY)).toBe('ko');
  });

  /*
   * The mirror-absent guard is an OPTIMISATION, not a correctness guard, and
   * this is what makes it falsifiable rather than decorative. Removing it
   * breaks no behaviour — recovery only reads, and a present mirror always
   * matches the row — so the only observable it has is the read itself.
   */
  it('does not touch the settings table when the mirror already answers', async () => {
    localStorage.setItem(LOCALE_MIRROR_KEY, 'ko');
    const read = vi.spyOn(settings, 'get');
    try {
      setup();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(read.mock.calls.filter(([key]) => key === LOCALE_KEY)).toHaveLength(0);
    } finally {
      read.mockRestore();
    }
  });

  /*
   * The race `useTypography` was bitten by, in this hook's own shape: the
   * recovery read is asynchronous, so a click landing before it resolves must
   * win, or a stale row silently undoes the reader's choice.
   *
   * Staged to DISCRIMINATE, which the first attempt did not. The stored row
   * and the starting locale are both `ko` and the click moves to `en`, so
   * without the `touched` guard the recovery reads `ko`, finds it differs, and
   * reverts — a version that ignores the guard fails here. `fireEvent` rather
   * than `userEvent` because it is synchronous: the click has to land inside
   * the window the read leaves open, and `userEvent` awaits it shut.
   */
  it('lets a click made during recovery win over the stored row', async () => {
    await settings.set(LOCALE_KEY, 'ko');
    setup('ko');

    fireEvent.click(screen.getByRole('button', { name: 'English로 전환' }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('button', { name: 'Switch to Korean' })).toBeTruthy();
    expect(localStorage.getItem(LOCALE_MIRROR_KEY)).toBe('en');
  });
});
