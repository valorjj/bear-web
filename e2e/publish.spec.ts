import { expect, test } from '@playwright/test';

import type { Corpus, SeedNote } from './fixtures/corpus.ts';
import { FIXED_NOW } from './fixtures/corpus.ts';
import { ADOPTED_SYNC_SETTINGS, API_ORIGIN, signIn } from './fixtures/renderer.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * Sub-project M's end-to-end proof, entirely mocked at `${API_ORIGIN}/publish`
 * — `page.route` intercepts every request, so this suite needs no server and
 * runs unconditionally in `npm run test:e2e`. The real tunnel, the real host
 * split and the real headers are checked once, by hand, and recorded in the
 * task report rather than here (see `docs/superpowers/NEXT.md`).
 *
 * `publishNote` is local to this file rather than added to
 * `e2e/fixtures/corpus.ts` — that corpus drives the 256-file `shots` harness
 * and `measure.spec.ts`'s committed `measurements.md`, and a new note there
 * moves note-list geometry for reasons that have nothing to do with
 * publishing. (Same ruling `diagram.spec.ts` already recorded.)
 */

const publishNote: SeedNote = {
  id: 'publish-note',
  title: 'Publish Note',
  text: '# Publish Note\n\nSomething worth sharing.\n',
  createdAt: FIXED_NOW - 60_000,
  updatedAt: FIXED_NOW - 60_000,
  pinned: false,
  trashedAt: null,
  archivedAt: null,
};

const signedInCorpus: Corpus = {
  notes: [publishNote],
  settings: [...ADOPTED_SYNC_SETTINGS],
};

const signedOutCorpus: Corpus = { notes: [publishNote], settings: [] };

const PUBLISHED_ID = 'aB3dEf7GhIjKlMnOpQrStU';
const PUBLISHED_URL = `https://pub.markflowing.com/p/${PUBLISHED_ID}`;

/** Matches only `POST ${API_ORIGIN}/publish?...`, never the `DELETE .../publish/:id` route. */
function isPublishPost(url: URL): boolean {
  return url.origin === API_ORIGIN && url.pathname === '/publish';
}

async function routePublish(page: import('@playwright/test').Page): Promise<void> {
  await page.route(isPublishPost, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: PUBLISHED_ID, url: PUBLISHED_URL, publishedAt: FIXED_NOW }),
    }),
  );
}

async function openNote(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(publishNote.title) }).click();
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText(
    'Something worth sharing',
  );
}

async function openExportMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Export note' }).click();
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
}

test.describe('publish', () => {
  test('publishing shows a url containing the returned id', async ({ page }) => {
    await routePublish(page);

    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, signedInCorpus);
    await signIn(page);
    await openNote(page);
    await openExportMenu(page);
    await page.getByRole('menuitem', { name: 'Publish to web' }).click();
    await page
      .getByRole('dialog', { name: 'Published to the web' })
      .getByRole('button', { name: 'Publish to web' })
      .click();

    const field = page.getByRole('textbox', { name: 'Published to the web' });
    await expect(field).toHaveValue(PUBLISHED_URL);
    expect(await field.inputValue()).toContain(PUBLISHED_ID);
  });

  test('the published url can be copied to the real clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await routePublish(page);

    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, signedInCorpus);
    await signIn(page);
    await openNote(page);
    await openExportMenu(page);
    await page.getByRole('menuitem', { name: 'Publish to web' }).click();
    await page
      .getByRole('dialog', { name: 'Published to the web' })
      .getByRole('button', { name: 'Publish to web' })
      .click();

    const field = page.getByRole('textbox', { name: 'Published to the web' });
    await expect(field).toHaveValue(PUBLISHED_URL);
    // The dialog autofocuses this readonly field and selects its whole
    // contents on focus — there is no dedicated copy button (see
    // `PublishDialog.tsx`'s own docblock on the byte budget that ruled one
    // out) — so the real user action a keyboard-only or mouse user takes is
    // the platform copy shortcut over the pre-selected text.
    await expect(field).toBeFocused();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(PUBLISHED_URL);
  });

  test('unpublish asks for confirmation before it takes effect', async ({ page }) => {
    let deleteCalls = 0;

    await routePublish(page);
    await page.route(`${API_ORIGIN}/publish/${PUBLISHED_ID}`, (route) => {
      deleteCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, signedInCorpus);
    await signIn(page);
    await openNote(page);
    await openExportMenu(page);
    await page.getByRole('menuitem', { name: 'Publish to web' }).click();
    await page
      .getByRole('dialog', { name: 'Published to the web' })
      .getByRole('button', { name: 'Publish to web' })
      .click();

    await expect(page.getByRole('textbox', { name: 'Published to the web' })).toHaveValue(
      PUBLISHED_URL,
    );

    await page.getByRole('button', { name: 'Unpublish' }).click();

    // A confirmation appears and nothing has been sent yet.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('The link will stop working immediately');
    expect(deleteCalls).toBe(0);

    await confirmDialog.getByRole('button', { name: 'Unpublish' }).click();

    expect(deleteCalls).toBe(1);
    await expect(page.getByRole('button', { name: 'Publish to web' })).toBeVisible();
  });

  test('signed out, the menu item is aria-disabled with the reason in its name, reached and activated by keyboard', async ({
    page,
  }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, signedOutCorpus);
    await openNote(page);
    await openExportMenu(page);

    const publish = page.getByRole('menuitem', { name: /Publish to web/ });

    // `aria-disabled`, not the HTML attribute: a keyboard user must still be
    // able to reach the item to discover why it does nothing.
    await expect(publish).toHaveAttribute('aria-disabled', 'true');
    await expect(publish).toHaveAccessibleName(/sign in/i);

    // `locator.click()` cannot be used here: Playwright's actionability check
    // treats `aria-disabled="true"` as "not enabled" and waits out the full
    // timeout rather than clicking — `{ force: true }` would synthesise an
    // event no user can produce. Focus opens on the first item (Markdown);
    // three Tabs land on Publish (Markdown, HTML, PDF, Publish).
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(publish).toBeFocused();

    await page.keyboard.press('Enter');

    // Nothing happened: the dialog never opened, and the menu is still open.
    await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Published to the web' })).toHaveCount(0);
  });
});
