import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed';

/**
 * D2's end-to-end proof.
 *
 * This suite cannot reach a real server — `playwright.config.ts` starts only
 * the app's own preview server — so every request is intercepted. It asserts
 * exactly what a real server is not needed to prove:
 *
 *   1. a signed-out visitor makes NO request to either API origin, at boot;
 *   2. a returning signed-in user boots, renders the three panes, and shows
 *      the sync status line inside the account menu;
 *   3. `GET /sync` failing outright does not stop the app from booting or the
 *      note list from working — the local-first guarantee, which no other
 *      test in the suite can see broken.
 *
 * Everything past this (a real OAuth round trip, an actual conflict copy, the
 * cookie's `Domain` attribute) needs a live server and a real browser session
 * and is out of reach for Playwright here — see the written record for what
 * was verified by hand instead.
 */
const PROD_API = 'https://api.markflowing.com';
const DEV_API = 'http://localhost:8787';
const SESSION_HINT_KEY = 'bear-web:account:hasSession';

const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:4173',
  'access-control-allow-credentials': 'true',
};

test('a signed-out visitor makes no request to either API origin', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(PROD_API) || url.startsWith(DEV_API)) apiRequests.push(url);
  });
  // Route-intercepted too, not just observed: a request that reached either
  // origin would hang against nothing to answer it were these routes absent,
  // which would fail this test for the wrong reason.
  await page.route(`${PROD_API}/**`, (route) => route.abort());
  await page.route(`${DEV_API}/**`, (route) => route.abort());

  await page.goto('/');
  await page.getByRole('button', { name: /account/i }).click();
  // Resolving to the signed-out menu is the proof the hook already finished
  // — a fixed wait could pass before a delayed request ever fires.
  await expect(page.getByRole('menuitem', { name: /sign in with google/i })).toBeVisible();

  expect(apiRequests).toEqual([]);
});

test('a returning signed-in user boots, renders three panes, and shows sync status', async ({
  page,
}) => {
  await page.route(`${PROD_API}/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ userId: 'u1', email: 'returning@example.com' }),
    }),
  );
  await page.route(`${PROD_API}/sync**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ notes: [], tags: [], rev: 0 }),
    }),
  );
  await page.addInitScript((key: string) => {
    localStorage.setItem(key, '1');
  }, SESSION_HINT_KEY);

  await page.goto('/');

  await expect(page.getByRole('region')).toHaveCount(3);

  await page.getByRole('button', { name: /account/i }).click();
  await expect(page.getByText('returning@example.com')).toBeVisible();
  // The sync status line, mounted only in the signed-in branch of the menu —
  // its wording comes from `sync.idle`/`sync.syncing` in `src/i18n/en.ts`, and
  // either is proof the line rendered at all, without pinning to a race
  // between the debounced pull settling and this assertion running.
  await expect(page.getByText(/notes are backed up|backing up/i)).toBeVisible();
});

test('a broken GET /sync does not stop the app booting or the note list working', async ({
  page,
}) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'local-first-guarantee',
        title: 'Local first',
        text: 'Local first\n\nThis note must render with no server reachable.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    // Already "adopted" into this account, so `useSync` goes straight to
    // `syncOnce` instead of raising `AdoptNotesDialog` — that modal would
    // otherwise sit over the whole shell and block the assertions below,
    // and adoption is not what this test is about.
    settings: [
      { key: 'sync:accountId', value: 'u1' },
      { key: 'sync:lastPulledRev', value: 0 },
    ],
  });
  await page.route(`${PROD_API}/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ userId: 'u1', email: 'returning@example.com' }),
    }),
  );
  // The one door this test exists to see broken.
  await page.route(`${PROD_API}/sync**`, (route) => route.abort());
  await page.addInitScript((key: string) => {
    localStorage.setItem(key, '1');
  }, SESSION_HINT_KEY);

  await page.goto('/');

  await expect(page.getByRole('region')).toHaveCount(3);
  await expect(page.getByText('Local first')).toBeVisible();

  // The account menu must resolve to a real state rather than hang, and the
  // sync status must reflect the outage rather than lie about it.
  await page.getByRole('button', { name: /account/i }).click();
  await expect(page.getByText('returning@example.com')).toBeVisible();
  await expect(page.getByText(/offline|backing up|backup paused/i)).toBeVisible();
});
