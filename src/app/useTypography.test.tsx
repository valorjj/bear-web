import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';

import { DEFAULTS, TYPOGRAPHY_KEY, TYPOGRAPHY_MIRROR_KEY, type Typography } from './typography';
import { useTypography } from './useTypography';

function Probe(): ReactElement {
  const { value, set, reset } = useTypography();
  return (
    <div>
      <span data-testid="size">{value.fontSize}</span>
      <button type="button" onClick={() => set({ ...value, fontSize: 20 })}>
        bigger
      </button>
      <button type="button" onClick={reset}>
        reset
      </button>
    </div>
  );
}

const READ = () => Number(screen.getByTestId('size').textContent);

describe('useTypography', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    await settings.remove(TYPOGRAPHY_KEY);
  });

  it('renders the defaults when nothing is stored', async () => {
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
  });

  /*
   * The mirror already painted the first frame, so seeding the live query
   * from anything else would make the app disagree with itself until
   * IndexedDB answered. This is the reason this hook is shaped like
   * `useTheme` and not like `useSetting`.
   */
  it('seeds from the mirror rather than from the constant defaults', () => {
    const mirrored: Typography = { ...DEFAULTS, fontSize: 19 };
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify(mirrored));
    render(<Probe />);
    expect(READ()).toBe(19);
  });

  it('lets the durable row win over the mirror', async () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ ...DEFAULTS, fontSize: 19 }));
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21 });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(21));
  });

  it('falls back to the defaults when the durable row is malformed', async () => {
    await settings.set(TYPOGRAPHY_KEY, { fontSize: 'huge' });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
  });

  it('applies the value to documentElement', async () => {
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21 });
    render(<Probe />);
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bear-font-size')).toBe('21px'),
    );
  });

  /*
   * The repair `useTheme` does not do. If the durable row is absent but the
   * mirror holds a preference, nothing there ever writes the row back, so a
   * cache quietly becomes the source of truth and clearing site data loses
   * the preference with no other trace.
   */
  it('heals an absent durable row from the mirror', async () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ ...DEFAULTS, fontSize: 19 }));
    render(<Probe />);
    await waitFor(async () => {
      expect(await settings.get<unknown>(TYPOGRAPHY_KEY, null)).toEqual({
        ...DEFAULTS,
        fontSize: 19,
      });
    });
  });

  /*
   * Both of these pin bugs the suite above actually caught, in the order it
   * caught them. Neither was foreseen when the hook was written.
   *
   * The first: healing fired when there was nothing to heal. With no mirror
   * and no row, `value` is just `DEFAULTS`, and writing that into the row made
   * the live query hand back a fresh object, which re-ran the apply effect and
   * rewrote the mirror — over a value the user had chosen in between.
   *
   * The second: the heal's read is asynchronous, so a change landing inside
   * the window between issuing it and it resolving was overwritten by the
   * first-render value the callback still held.
   */
  it('does not write a durable row when there is nothing to recover', async () => {
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
    // Long enough for an async heal to have resolved and written.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await settings.get<unknown>(TYPOGRAPHY_KEY, null)).toBeNull();
  });

  it('abandons the heal rather than clobbering a change made while it was in flight', async () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ ...DEFAULTS, fontSize: 19 }));
    render(<Probe />);
    // Synchronously, in the same tick the heal's read was issued.
    screen.getByRole('button', { name: 'bigger' }).click();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
      fontSize: 20,
    });
  });

  it('writes the durable row, the mirror and the DOM on set', async () => {
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
    screen.getByRole('button', { name: 'bigger' }).click();

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bear-font-size')).toBe('20px'),
    );
    expect(JSON.parse(localStorage.getItem(TYPOGRAPHY_MIRROR_KEY) ?? '{}')).toMatchObject({
      fontSize: 20,
    });
    await waitFor(async () => {
      expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
        fontSize: 20,
      });
    });
  });

  it('restores every field on reset', async () => {
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21, lineWidth: 60 });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(21));

    screen.getByRole('button', { name: 'reset' }).click();

    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
    expect(document.documentElement.style.getPropertyValue('--bear-line-width')).toBe('40em');
  });
});
