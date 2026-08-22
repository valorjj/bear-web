import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed';

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

const SIDEBAR_WIDTH_KEY = 'pane.sidebarWidth';
/** The narrowest the sidebar goes, where a 256px menu overhangs most. */
const NARROW_SIDEBAR = 160;

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

/**
 * The sidebar `Pane` carries `overflow-hidden` so the tag tree scrolls under a
 * pinned footer. That clips any descendant wider than the pane, so an
 * absolutely-positioned account menu lost its right edge and cut the
 * disclosure line mid-sentence — reported from the running app, invisible to
 * every other test because jsdom has no layout engine and nothing else here
 * measures where a surface is actually painted.
 *
 * `elementFromPoint` is the check, not a bounding box: a clipped element still
 * reports its full layout rect, so a geometry assertion would pass while the
 * pixels were missing. This asks the browser what is actually painted at the
 * menu's far edge.
 */
test('the account menu is not clipped by the sidebar pane', async ({ page }) => {
  // Seeded through IndexedDB, not localStorage: pane widths are a `settings`
  // row read by `useSetting`. An `addInitScript` writing localStorage here
  // looks right and silently does nothing, leaving the sidebar at its default
  // and the assertion below measuring a width it never set.
  await seedDatabase(page, {
    notes: [],
    settings: [{ key: SIDEBAR_WIDTH_KEY, value: NARROW_SIDEBAR }],
  });
  await page.goto('/');

  await page.getByRole('button', { name: /account/i }).click();
  const menu = page.getByRole('dialog', { name: /account|계정/i });
  await expect(menu).toBeVisible();

  const probe = await menu.evaluate((element, narrow: number) => {
    const rect = element.getBoundingClientRect();
    // Just inside the menu's right edge, vertically centred — the region that
    // falls outside the sidebar pane and was previously clipped away.
    const x = rect.right - 4;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      found: hit !== null,
      insideMenu: hit !== null && (hit === element || element.contains(hit)),
      overhangsPane: rect.right > narrow,
      withinViewport: rect.right <= window.innerWidth && rect.left >= 0,
    };
  }, NARROW_SIDEBAR);

  // Guards the guard: if the probe coordinate landed on nothing, `insideMenu`
  // would be false for a reason that has nothing to do with clipping.
  expect(probe.found, 'elementFromPoint hit nothing — the probe coordinate is wrong').toBe(true);
  expect(probe.overhangsPane, 'the menu no longer overhangs, so this proves nothing').toBe(true);
  expect(probe.insideMenu, 'the menu is clipped: its right edge is not painted').toBe(true);
  expect(probe.withinViewport, 'the menu escaped the pane but left the screen').toBe(true);
});
