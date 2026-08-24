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

test.describe('the class/function role conflict', () => {
  // Task 4's review, round 1: highlight.js puts BOTH `hljs-title` (the
  // `function` role) and `class_` (the `type` role) on one span for a class
  // name, and `title.class.inherited__` adds a third class, `inherited__`
  // (also `type`), for the parent named in an `extends` clause. Single-class
  // selectors alone would leave the winner decided by which of
  // `editor.css`'s six blocks happens to sit later in the file — this test
  // is the OUTCOME check the class-set guard in `highlightClasses.test.ts`
  // cannot provide: it renders real code in the real editor and asserts
  // which colour actually painted, pinning `type` against `function` rather
  // than trusting that a compound selector was written correctly.
  test('a class name wins --bear-code-type over --bear-code-function, and a function name still gets --bear-code-function', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    // Fixes the theme so the resolved tokens below are deterministic.
    const tokens = await readThemeTokens(page, 'paper', ['code-type', 'code-function']);

    await page.getByRole('button', { name: 'New note' }).click();
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.click();

    // The ``` + language + Enter sequence is CodeBlockLowlight's own input
    // rule — the same mechanism `notes.spec.ts`'s task-list test exercises —
    // so this is real Markdown input, not a programmatic node insertion.
    // `class A extends B` puts `hljs-title` + `class_` + `inherited__` on
    // `B` and `hljs-title` + `class_` (no `inherited__`) on `A`; `function f`
    // puts `hljs-title` + `function_` on `f`, with no conflicting class.
    await page.keyboard.type('```typescript\n');
    await page.keyboard.type('function f() {}\n');
    await page.keyboard.type('class A extends B {}');

    const className = editor.locator('.hljs-title.class_', { hasText: 'A' }).first();
    const functionName = editor.locator('.hljs-title.function_', { hasText: 'f' }).first();
    await expect(className).toBeVisible();
    await expect(functionName).toBeVisible();

    const [classColour, functionColour] = await Promise.all([
      className.evaluate((el) => getComputedStyle(el).color),
      functionName.evaluate((el) => getComputedStyle(el).color),
    ]);

    expect(classColour).toBe(tokens['code-type']);
    expect(functionColour).toBe(tokens['code-function']);
    // The two roles must actually differ, or the assertions above could both
    // pass by coincidence against a broken mapping that paints everything
    // one colour.
    expect(classColour).not.toBe(functionColour);
  });
});
