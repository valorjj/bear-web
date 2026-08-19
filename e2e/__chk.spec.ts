import { expect, test } from '@playwright/test';

test('sidebar vs editor elevation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'indigo-light'));
  const out = await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label]')].map((p) => ({
      label: p.getAttribute('aria-label'),
      classes: p.className,
      box: getComputedStyle(p).boxShadow.split('), ').pop(),
    })),
  );
  console.log('RESULT', JSON.stringify(out, null, 1));
  expect(true).toBe(true);
});
