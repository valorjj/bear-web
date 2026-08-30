import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The code block's copy button, in a real browser.
 *
 * Three of these assertions are impossible in Vitest. `toBeVisible()` cannot
 * see an `opacity` rule at all — `docs/rulings/testing-and-tooling.md` records
 * a hover-reveal shipping here with no coverage behind exactly that
 * false-positive — so the reveal is checked with a polled `toHaveCSS`. The
 * real clipboard needs a real browser and a permission grant. And whether the
 * button can take keyboard focus is a live Chromium behaviour, not a DOM fact.
 */
test.describe('the code copy button', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await page.getByRole('button', { name: /Highlighting three languages/ }).click();
    await expect(page.getByRole('region', { name: 'Editor' }).locator('pre').first()).toBeVisible();
  });

  test('puts one button on every code block, not only the focused one', async ({ page }) => {
    const editor = page.getByRole('region', { name: 'Editor' });

    // The corpus note carries three fenced blocks. A control anchored to the
    // caret's block — the shape `CodeLanguageControls` uses — would render one.
    await expect(editor.locator('[data-code-copy]')).toHaveCount(
      await editor.locator('pre').count(),
    );
  });

  test('is hidden at rest and revealed by hovering the block', async ({ page }) => {
    const editor = page.getByRole('region', { name: 'Editor' });
    const button = editor.locator('[data-code-copy]').first();

    await expect(button).toHaveCSS('opacity', '0');

    await editor.locator('pre').first().hover();

    // Polled, and against the computed value: the reveal runs through a 100ms
    // transition, so a single synchronous read immediately after the hover
    // catches it mid-flight and reports the resting value. That is what this
    // assertion looked like when it first failed against working CSS.
    await expect(button).toHaveCSS('opacity', '1');
  });

  test('copies that block’s own text to the real clipboard', async ({ page }) => {
    const editor = page.getByRole('region', { name: 'Editor' });
    const second = editor.locator('pre').nth(1);
    const expected = ((await second.locator('code').textContent()) ?? '').trim();
    expect(expected.length, 'the fixture block is empty, so this proves nothing').toBeGreaterThan(
      0,
    );

    await second.hover();
    await editor.locator('[data-code-copy]').nth(1).click();

    const pasted = await page.evaluate(() => navigator.clipboard.readText());

    // The SECOND block's text specifically. An implementation that resolved
    // the first code block, or the one under the caret, passes any assertion
    // weaker than this one.
    expect(pasted.trim()).toBe(expected);
  });

  test('is reachable and operable by keyboard alone', async ({ page }) => {
    const editor = page.getByRole('region', { name: 'Editor' });
    const button = editor.locator('[data-code-copy]').first();

    // Unlike the fold gutter — where Chromium refuses focus to every
    // descendant of a heading containing a widget — a code block is not a
    // heading, so this control genuinely can be focused. If Chromium ever
    // widens that behaviour, this test is what notices.
    await button.focus();
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('opacity', '1');

    await page.keyboard.press('Enter');

    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    expect(pasted.length).toBeGreaterThan(0);
  });
});
