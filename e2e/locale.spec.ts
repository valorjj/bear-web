import { expect, test } from '@playwright/test';

/*
 * Driven through the toggle's OWN accessible name and `documentElement.lang`,
 * never through a translated note-list row. Those rows carry a count in their
 * accessible name, and this machine's Chromium reports a Korean
 * `navigator.languages`, so a spec written against row labels both fails
 * strict mode and depends on which language the runner happens to detect.
 */
const TO_KO = { name: 'Switch to Korean' } as const;
const TO_EN = { name: 'English로 전환' } as const;

/**
 * Forces a known starting language, whatever the runner's browser reports —
 * this machine's Chromium detects Korean, so a spec that assumed English
 * passes and fails by accident of where it runs.
 *
 * Seeded with `evaluate` and a reload rather than `addInitScript`, which runs
 * on EVERY navigation: an init script here re-seeds the mirror during the
 * reload the no-flash test performs, silently undoing the click it is meant to
 * be checking. That cost one confusing failure.
 */
async function start(page: import('@playwright/test').Page, locale: 'en' | 'ko'): Promise<void> {
  await page.goto('/');
  await page.evaluate((value: string) => {
    localStorage.setItem('bear-web:locale', value);
  }, locale);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

test('the toggle names the language it switches TO, in the language in force', async ({ page }) => {
  await start(page, 'en');
  await expect(page.getByRole('button', TO_KO)).toBeVisible();

  await page.getByRole('button', TO_KO).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('button', TO_EN)).toBeVisible();
  await expect(page.getByRole('button', TO_KO)).toHaveCount(0);
});

test('the chosen language survives a reload, with no flash of the other one', async ({ page }) => {
  await start(page, 'en');
  await page.getByRole('button', TO_KO).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');

  /*
   * The mirror is read during the provider's FIRST render, so the reader never
   * sees a frame in the detected language. Asserting after load cannot tell
   * that apart from a late correction, so this records what was rendered the
   * first time React painted anything — `#root` gaining children.
   */
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __firstPaint: string[] }).__firstPaint = seen;
    /*
     * Watches for the TOGGLE, whose accessible name comes straight off the
     * bundle, rather than for `#root` gaining any child. The first version did
     * the latter and read "the sidebar has not rendered yet" as "English",
     * reporting a flash that was never there.
     */
    new MutationObserver((_records, observer) => {
      const toggle = document.querySelector(
        '[aria-label="Switch to Korean"], [aria-label="English로 전환"]',
      );
      if (toggle === null) return;
      seen.push(toggle.getAttribute('aria-label') === 'English로 전환' ? 'ko' : 'en');
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });

  await page.reload();
  await expect(page.getByRole('button', TO_EN)).toBeVisible();

  const painted = await page.evaluate(
    () => (window as unknown as { __firstPaint: string[] }).__firstPaint,
  );
  expect(painted.length, 'the observer never saw the app mount').toBe(1);
  expect(painted[0], 'the app painted the wrong language before correcting itself').toBe('ko');
});

test('switching back is a round trip, not a one-way door', async ({ page }) => {
  await start(page, 'ko');
  await page.getByRole('button', TO_EN).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', TO_KO).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});

test('a corrupt stored language falls back to detection rather than breaking boot', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('bear-web:locale', 'jp'));
  await page.goto('/');
  // Whatever the runner detects, the app must render and offer the toggle.
  await expect(page.locator('section[aria-label]')).toHaveCount(3);
  await expect(page.getByRole('button', TO_KO).or(page.getByRole('button', TO_EN))).toBeVisible();
});
