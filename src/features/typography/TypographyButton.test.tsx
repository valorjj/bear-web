import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULTS, TYPOGRAPHY_KEY, type Typography } from '@/app/typography';
import { settings } from '@/data';
import { I18nProvider } from '@/i18n';

import { TypographyButton } from './TypographyButton';

function setup() {
  return render(
    <I18nProvider>
      <TypographyButton />
    </I18nProvider>,
  );
}

describe('TypographyButton', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    await settings.remove(TYPOGRAPHY_KEY);
  });

  it('labels its icon-only trigger', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Typography' })).toBeTruthy();
  });

  it('opens the panel and reports expansion', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Typography' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Typography' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Done', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Typography' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /*
   * The whole loop, which is the only thing this component adds over its two
   * halves: a slider move reaches the durable row through the hook. Both
   * halves are tested in isolation elsewhere; what can only break here is the
   * wiring between them.
   */
  it('persists a change made in the panel', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Typography' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Font size' }), {
      target: { value: '19' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(async () => {
      expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
        fontSize: 19,
      });
    });
  });

  /*
   * Closing the panel is not a cancel. The change was already visible in the
   * note behind the modal, so discarding it on close would contradict what the
   * user just watched happen — and the flush-on-unmount in `TypographyPanel`
   * exists precisely so a quick nudge-then-close survives.
   */
  it('keeps a change that was still inside the debounce when the panel closed', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Typography' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Line width' }), {
      target: { value: '60' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(document.documentElement.style.getPropertyValue('--bear-line-width')).toBe('60em');
    await waitFor(async () => {
      expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
        lineWidth: 60,
      });
    });
  });
});
