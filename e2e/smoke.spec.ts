import { expect, test } from '@playwright/test';

test('the shell renders and the theme toggle works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'bear-web' })).toBeVisible();

  const getBodyColors = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });

  expect(await getBodyColors()).toEqual({
    backgroundColor: 'rgb(255, 255, 255)',
    color: 'rgb(28, 28, 30)',
  });

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  expect(await getBodyColors()).toEqual({
    backgroundColor: 'rgb(28, 28, 30)',
    color: 'rgb(242, 242, 247)',
  });
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
