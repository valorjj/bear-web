import { expect, test } from '@playwright/test';

test('the shell renders and the theme toggle works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'bear-web' })).toBeVisible();

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the page loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'bear-web' })).toBeVisible();

  expect(errors).toEqual([]);
});
