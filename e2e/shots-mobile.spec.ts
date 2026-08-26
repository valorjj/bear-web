import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * Phone reference screenshots, in the default theme only.
 *
 * Nothing in the test suite can see "renders wrong" — the unit suite has no
 * layout engine and `e2e/appearance.spec.ts` is deliberately relative — so a
 * layout change is checked against a picture.
 *
 * Four shots, not the roster of sixteen themes `npm run shots` covers: this is
 * a LAYOUT check, and the desktop shots already prove every theme paints. Run
 * with `npm run shots:mobile`, and **count the four files** rather than trust
 * the exit code — a spec whose grep matched nothing exits 0.
 *
 * Tagged `@shots` so `playwright.config.ts`'s existing
 * `grepInvert: /@shots|@measure/` keeps it out of `npm run test:e2e`.
 */
const OUT = 'docs/design/shots/mobile';

test.describe('@shots phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    timezoneId: 'Asia/Seoul',
  });

  test('the four phone surfaces', async ({ page }) => {
    await seedDatabase(page, CORPUS);
    // Pinned, or `formatNoteDate` renders today's notes as a time and older
    // ones as a date, and no two runs are comparable.
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto('/');

    const anyRow = page.getByRole('button', { name: /US market/ });
    await expect(anyRow).toBeVisible();
    await page.screenshot({ path: `${OUT}/list.png` });

    await page.getByRole('button', { name: 'Show tags' }).click();
    await expect(page.getByRole('dialog', { name: 'Tags and lists' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/drawer.png` });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Show search' }).click();
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.screenshot({ path: `${OUT}/search.png` });
    await page.keyboard.press('Escape');

    await anyRow.click();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/editor.png` });
  });
});
