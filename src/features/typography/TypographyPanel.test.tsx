import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOUNDS, DEFAULTS, type Typography } from '@/app/typography';
import { I18nProvider } from '@/i18n';

import { TypographyPanel } from './TypographyPanel';

function setup(value: Typography = DEFAULTS) {
  const onCommit = vi.fn();
  const onDismiss = vi.fn();
  render(
    <I18nProvider>
      <TypographyPanel value={value} onCommit={onCommit} onDismiss={onDismiss} />
    </I18nProvider>,
  );
  return { onCommit, onDismiss };
}

const size = () => screen.getByRole('slider', { name: 'Font size' }) as HTMLInputElement;
const prop = (name: string) => document.documentElement.style.getPropertyValue(name);

/*
 * jsdom implements no range WIDGET, only the element: it has no layout and no
 * key handling for one, so `userEvent.type(slider, '{arrowright}')` fires
 * keyboard events that move nothing and the test fails as "nothing happened"
 * rather than as anything informative. `fireEvent.change` is how a range is
 * driven here. Real keyboard interaction on a real slider is a Playwright
 * concern, and `e2e/typography.spec.ts` covers it.
 */
function slide(slider: HTMLElement, value: number): void {
  fireEvent.change(slider, { target: { value: String(value) } });
}

describe('TypographyPanel', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    vi.useRealTimers();
  });

  it('renders one labelled slider per field, with its bounds', () => {
    setup();
    for (const [field, name] of [
      ['fontSize', 'Font size'],
      ['lineHeight', 'Line height'],
      ['lineWidth', 'Line width'],
      ['paraSpacing', 'Paragraph spacing'],
      ['paraIndent', 'Paragraph indent'],
    ] as const) {
      const slider = screen.getByRole('slider', { name }) as HTMLInputElement;
      expect(slider.min).toBe(String(BOUNDS[field].min));
      expect(slider.max).toBe(String(BOUNDS[field].max));
      expect(slider.step).toBe(String(BOUNDS[field].step));
    }
  });

  /*
   * The accessible name must be the label ALONE. The readout sits beside it,
   * and if it were inside the label every slider would announce as "Font size
   * 16 px" while ALSO carrying the value in `aria-valuetext` — the same
   * concatenated-name defect this project has shipped three times
   * (`SidebarRow`'s lost space, `NoteListItem`'s three spans, and the theme
   * card's sample sentence).
   */
  it('names each slider by its label alone, and carries the value in aria-valuetext', () => {
    setup();
    expect(size().getAttribute('aria-valuetext')).toBe('16 px');
    expect(screen.getByRole('slider', { name: 'Line height' }).getAttribute('aria-valuetext')).toBe(
      '1.6',
    );
    expect(screen.getByRole('slider', { name: 'Line width' }).getAttribute('aria-valuetext')).toBe(
      '40 em',
    );
  });

  it('writes the custom property on change, before any commit', () => {
    setup();
    slide(size(), 17);
    expect(prop('--bear-font-size')).toBe('17px');
  });

  /*
   * A slider fires a change on every tick. Committing each one would write
   * IndexedDB and re-render the whole shell thirty times during one drag.
   */
  it('commits once, on a trailing debounce, not per tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onCommit } = setup();

    slide(size(), 17);
    slide(size(), 18);
    slide(size(), 19);
    expect(prop('--bear-font-size'), 'the preview must be live, not debounced').toBe('19px');
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({ ...DEFAULTS, fontSize: 19 });
  });

  /*
   * The failure mode the debounce introduces, and the reason the cleanup
   * FLUSHES rather than cancels: a user who nudges a slider and immediately
   * closes the panel must not lose the change.
   */
  it('flushes a pending commit when it unmounts', () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <I18nProvider>
        <TypographyPanel value={DEFAULTS} onCommit={onCommit} onDismiss={vi.fn()} />
      </I18nProvider>,
    );

    slide(screen.getByRole('slider', { name: 'Font size' }), 17);
    expect(onCommit).not.toHaveBeenCalled();
    unmount();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({ ...DEFAULTS, fontSize: 17 });
  });

  it('resets every field at once, without waiting for the debounce', async () => {
    const { onCommit } = setup({
      fontSize: 21,
      lineHeight: 1.9,
      lineWidth: 60,
      paraSpacing: 0.5,
      paraIndent: 1,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onCommit).toHaveBeenCalledWith(DEFAULTS);
    expect(size().value).toBe('16');
    expect(prop('--bear-line-width')).toBe('40em');
    expect(prop('--bear-para-indent')).toBe('0em');
  });

  // A disabled control a user reaches for and cannot press explains nothing.
  it('leaves Reset enabled at the defaults', () => {
    setup();
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('dismisses on Done and on Escape', async () => {
    const { onDismiss } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
