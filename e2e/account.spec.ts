import { expect, test } from '@playwright/test';

/**
 * The boot `/me` gate.
 *
 * `AccountMenu` is mounted in the shell, so before the "has signed in before"
 * hint existed every page load by every visitor fired a cross-origin request
 * at this origin — which turned `smoke.spec.ts` red on
 * `net::ERR_NAME_NOT_RESOLVED` and was a permanent console error for anyone
 * offline. Nothing in the unit suite can see a real network request being
 * made, which is why this lives here.
 */
const API = 'https://api.markflowing.com';

test('a guest makes no request to the API origin at boot', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API)) apiRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('button', { name: /account/i }).click();
  // The menu resolving to the signed-out state is the proof that the hook
  // finished, rather than a timeout that a slow machine could outrun.
  await expect(page.getByRole('menuitem', { name: /sign in with google/i })).toBeVisible();

  expect(apiRequests).toEqual([]);
});

test('a returning signed-in user resolves at boot without opening the menu', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API)) apiRequests.push(request.url());
  });
  await page.route(`${API}/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': 'http://localhost:4173',
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify({ userId: 'u1', email: 'returning@example.com' }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('bear-web:account:hasSession', '1');
  });

  await page.goto('/');
  await expect.poll(() => apiRequests.length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(apiRequests[0]).toBe(`${API}/me`);

  await page.getByRole('button', { name: /account/i }).click();
  await expect(page.getByText('returning@example.com')).toBeVisible();
});
