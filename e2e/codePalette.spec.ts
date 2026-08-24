import { expect, test } from '@playwright/test';

import { parseColour } from '../scripts/contrast.ts';
import { readThemeTokens } from './fixtures/tokens.ts';

const ROLES = ['keyword', 'string', 'number', 'comment', 'function', 'type'] as const;
const NAMES = ROLES.map((role) => `code-${role}`);

test.describe('the syntax palette', () => {
  test('resolves all six roles on a light theme and a dark one', async ({ page }) => {
    await page.goto('/');

    // Waits for the shell: `goto` resolves on the document, not on React,
    // and under load the read below would otherwise run against a bare
    // `<div id="root">`. Matches `e2e/contrast.spec.ts`'s readiness wait —
    // the brief's own `getByRole('textbox').first()` never resolves on a
    // fresh, unseeded database, because no note is open and nothing in the
    // shell has an accessible role of `textbox`.
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    for (const theme of ['paper', 'ink']) {
      const tokens = await readThemeTokens(page, theme, NAMES);
      for (const name of NAMES) {
        expect(tokens[name], `${theme}'s --bear-${name} did not resolve`).toBeTruthy();
        const colour = parseColour(tokens[name]!);
        // `parseColour` yields NaN on a format it cannot read, and every
        // downstream comparison against NaN is false — so an unreadable value
        // passes a naive check. Assert the numbers are numbers.
        expect(Number.isNaN(colour.r), `${theme} ${name} parsed to NaN`).toBe(false);
      }
    }
  });

  test('a theme at --bear-dark 0.5 lands between the two literals', async ({ page }) => {
    // THE mechanism test. If --bear-dark cannot interpolate two colours, this
    // is where it shows, and the fallback is six explicit overrides in each of
    // the seven dark theme blocks.
    await page.goto('/');
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    const probe = await page.evaluate(() => {
      const root = document.documentElement;
      const read = (dark: string) => {
        root.setAttribute('data-theme', 'paper');
        root.style.setProperty('--bear-dark', dark);
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.color = 'var(--bear-code-keyword)';
        document.body.appendChild(el);
        const value = getComputedStyle(el).color;
        el.remove();
        return value;
      };
      const light = read('0');
      const mid = read('0.5');
      const dark = read('1');
      root.style.removeProperty('--bear-dark');
      return { light, mid, dark };
    });

    expect(probe.light).not.toBe(probe.dark);
    expect(probe.mid).not.toBe(probe.light);
    expect(probe.mid).not.toBe(probe.dark);

    // The three string-inequality checks above pass for ANY third colour,
    // including one nothing to do with interpolation — a broken --bear-dark
    // that instead landed on, say, a fixed grey would still be "distinct
    // from both endpoints" and slip through. What the test's name actually
    // claims is betweenness, so parse all three and check it for real: each
    // channel of the midpoint colour must sit between the corresponding
    // channels of the light and dark endpoints (inclusive, since oklab
    // interpolation is not guaranteed monotone per sRGB channel at the
    // gamut edge, though it is for this role's two literals).
    const light = parseColour(probe.light);
    const mid = parseColour(probe.mid);
    const dark = parseColour(probe.dark);
    for (const channel of ['r', 'g', 'b'] as const) {
      const lo = Math.min(light[channel], dark[channel]);
      const hi = Math.max(light[channel], dark[channel]);
      expect(
        mid[channel],
        `mid ${channel}=${mid[channel]} is not between light ${channel}=${light[channel]} and dark ${channel}=${dark[channel]}`,
      ).toBeGreaterThanOrEqual(lo);
      expect(
        mid[channel],
        `mid ${channel}=${mid[channel]} is not between light ${channel}=${light[channel]} and dark ${channel}=${dark[channel]}`,
      ).toBeLessThanOrEqual(hi);
    }
  });
});
