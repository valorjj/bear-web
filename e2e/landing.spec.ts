import { expect, test } from '@playwright/test';

/**
 * The only spec that opts OUT of the shared `storageState` in
 * `playwright.config.ts`, which pre-dismisses the landing gate for every
 * other spec in the suite. Without this override the app opens straight to
 * the shell and every assertion below would fail confusingly.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('a first-time visitor is offered both ways in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
  // The app itself must not be behind it: the three-pane shell renders its
  // panes as `region`s (see `smoke.spec.ts`), and the landing screen is a
  // bare `<main>` with none.
  await expect(page.getByRole('region')).toHaveCount(0);
});

test('the guest choice enters the app with one welcome note', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as guest' }).click();

  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();

  // The note row, the way `notePreview.spec.ts` and `notes.spec.ts` locate
  // one: a button carrying the title in its accessible name.
  await expect(page.getByRole('button', { name: /Welcome/ })).toBeVisible();

  // The tag written inline in the note body reaches the sidebar through the
  // real parser and the real tag index, so this asserts the whole seed path.
  // Located the way `notes.spec.ts` locates a sidebar tag row: scoped to the
  // 'Tags' navigation, matched on the leading word so a longer label (a count
  // suffix) still matches.
  const tags = page.getByRole('navigation', { name: 'Tags' });
  await expect(tags.getByRole('button', { name: /^inbox\b/ })).toBeVisible({ timeout: 10_000 });
});

test('the landing screen never returns, and neither does a deleted welcome note', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByRole('button', { name: /Welcome/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();

  // Empty the database the way the app itself would, then reload: the seeded
  // flag must keep the note from coming back.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('bear-web');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();
  await expect(page.getByRole('button', { name: /Welcome/ })).toHaveCount(0);
});
