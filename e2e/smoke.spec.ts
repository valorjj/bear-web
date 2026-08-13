import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const DEFAULT_SIDEBAR_WIDTH = 240;
const DATABASE_NAME = 'bear-web';
const SIDEBAR_WIDTH_KEY = 'pane.sidebarWidth';

/**
 * Reads the persisted sidebar width straight out of IndexedDB, bypassing the
 * rendered DOM entirely. The DOM cannot be used to detect whether a resize
 * commit has actually reached storage: the optimistic override in
 * `usePaneWidths` (kept, deliberately, to satisfy Finding 3 — no flash back
 * to the stale width on release) makes the rendered width read as
 * "committed" the instant a drag ends, well before the async
 * `settings.set` write it is fire-and-forget from has landed.
 */
function readSidebarWidthFromIndexedDb(page: Page): Promise<number | undefined> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<number | undefined>((resolve) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => resolve(undefined);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('settings')) {
            db.close();
            resolve(undefined);
            return;
          }
          const getRequest = db
            .transaction('settings', 'readonly')
            .objectStore('settings')
            .get(key);
          getRequest.onsuccess = () => {
            const row = getRequest.result as { value?: unknown } | undefined;
            db.close();
            resolve(typeof row?.value === 'number' ? row.value : undefined);
          };
          getRequest.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
      }),
    { dbName: DATABASE_NAME, key: SIDEBAR_WIDTH_KEY },
  );
}

test('the three-pane shell renders with empty states', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('region')).toHaveCount(3);
  await expect(page.getByRole('separator')).toHaveCount(2);
});

test('the shell uses the token layer for its colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await expect(page.getByRole('region')).toHaveCount(3);

  const bodyColors = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });

  // These pin the shipped palette deliberately: a token change SHOULD require a
  // conscious edit here, because this is the only test that proves the
  // prefers-color-scheme cascade actually reaches a rendered pixel.
  // M7.5: the body's ground moved from --bear-bg to --bear-canvas, the darker
  // surface the three panes float on as cards.
  expect(bodyColors).toEqual({
    backgroundColor: 'rgb(232, 228, 222)',
    color: 'rgb(28, 27, 25)',
  });
});

test('the system dark preference applies with no JavaScript toggle', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await expect(page.getByRole('region')).toHaveCount(3);

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // These pin the shipped palette deliberately: a token change SHOULD require a
  // conscious edit here, because this is the only test that proves the
  // prefers-color-scheme cascade actually reaches a rendered pixel.
  // M7.5: the body's ground moved from --bear-bg to --bear-canvas.
  expect(background).toBe('rgb(18, 18, 17)');
});

test('a resized pane keeps its width across a reload', async ({ page }) => {
  await page.goto('/');

  const separator = page.getByRole('separator').first();
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const widthAfterResize = await page
    .getByRole('region')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);

  // Guard against the resize silently no-op'ing (e.g. onCommit never writing
  // to settings): without this, a stale-default-on-both-sides bug would still
  // make the reload assertion below pass trivially.
  expect(widthAfterResize).toBeGreaterThan(DEFAULT_SIDEBAR_WIDTH);

  await page.reload();
  await expect(page.getByRole('region')).toHaveCount(3);

  await expect
    .poll(() =>
      page
        .getByRole('region')
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(widthAfterResize);
});

test('the page loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);

  expect(errors).toEqual([]);
});

test('warns the user when the browser refuses to store data', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('IndexedDB is disabled');
      },
    });
  });

  await page.goto('/');

  // The app must still render, degraded rather than broken.
  await expect(page.getByRole('region')).toHaveCount(3);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('the shell never grows the page past the viewport, ready or degraded', async ({ page }) => {
  // Ready state: no banner, but the shell must still fill exactly the viewport
  // rather than exceeding it (h-full inside the flex column, not h-dvh, which
  // pins to the viewport regardless of the banner above it).
  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);

  const readyHeights = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(readyHeights.scrollHeight).toBe(readyHeights.innerHeight);

  // Degraded state: the banner adds height above the shell. If the shell keeps
  // demanding the full viewport height (h-dvh) rather than filling its parent,
  // the page overflows by exactly the banner's height and the undismissable
  // warning can be scrolled out of view — defeating its purpose.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('IndexedDB is disabled');
      },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);
  await expect(page.getByRole('alert')).toBeVisible();

  const degradedHeights = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(degradedHeights.scrollHeight).toBe(degradedHeights.innerHeight);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('alert')).toBeVisible();
});

test.describe('document language follows the active locale', () => {
  test.use({ locale: 'en-US' });

  test('documentElement.lang matches the rendered (English) UI', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region')).toHaveCount(3);

    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });
});

test('the resizer has a mouse hit target wider than its 1px visual line', async ({ page }) => {
  await page.goto('/');

  const separator = page.getByRole('separator').first();
  const box = await separator.boundingBox();
  if (!box) throw new Error('separator has no bounding box');

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  for (const offset of [-3, 3]) {
    const role = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('role') ?? null,
      { x: centerX + offset, y: centerY },
    );
    expect(role).toBe('separator');
  }
});

test('dragging a separator with the mouse resizes the pane without snapping back, and persists', async ({
  page,
}) => {
  await page.goto('/');

  const separator = page.getByRole('separator').first();
  const region = page.getByRole('region').first();

  const box = await separator.boundingBox();
  if (!box) throw new Error('separator has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY, { steps: 5 });
  await page.mouse.up();

  // Finding 3: no flash back to the stale stored default the instant the
  // drag is released — the optimistic width must already be the committed
  // one, not cleared until the live query catches up.
  const widthImmediatelyAfterRelease = await region.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(widthImmediatelyAfterRelease).toBeGreaterThan(DEFAULT_SIDEBAR_WIDTH);

  // The commit write is fire-and-forget (`onCommit` never awaits
  // `settings.set`), and the round trip through IndexedDB + the live query is
  // genuinely async, so assert persistence by polling rather than a single
  // reload check. This has to poll IndexedDB directly rather than the
  // rendered width: the optimistic override above (Finding 3) makes the DOM
  // read as "committed" immediately, so it can never distinguish "written"
  // from "not yet written" and reloading on its say-so races the real write
  // against page teardown, which can silently lose it.
  await expect
    .poll(() => readSidebarWidthFromIndexedDb(page))
    .toBeGreaterThan(DEFAULT_SIDEBAR_WIDTH);

  await page.reload();
  await expect(page.getByRole('region')).toHaveCount(3);

  await expect
    .poll(() => region.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(DEFAULT_SIDEBAR_WIDTH);
});
