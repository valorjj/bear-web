import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

/**
 * The external link's edit affordance.
 *
 * Unit tests drive the plugin's hover state directly (`linkEdit.test.ts`);
 * what only a browser can show is that the pencil is REACHABLE — it is
 * rendered on demand, so the pointer has to be able to travel from the link
 * text onto a button that only exists because the pointer is there — and that
 * revealing it does not move the line.
 */

const FIXED_NOW = Date.UTC(2026, 8, 15, 6, 0, 0);
const TEXT =
  '# Links\n\nRead [CommonMark](https://commonmark.org) for the spec, or the [style guide](https://style.test).';

async function seed(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-links',
        title: 'Links',
        text: TEXT,
        createdAt: FIXED_NOW - 1000,
        updatedAt: FIXED_NOW - 500,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [
      { key: 'pane.sidebarWidth', value: 240 },
      { key: 'pane.noteListWidth', value: 320 },
    ],
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  await page.getByRole('button', { name: /^Links,/ }).click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toContainText('CommonMark');
  return editor;
}

test.describe('the link edit pencil', () => {
  test('is absent at rest and appears on the hovered link only', async ({ page }) => {
    const editor = await seed(page);
    const button = page.locator('.bear-link-edit button');

    await expect(button).toHaveCount(0);

    await editor.getByText('CommonMark').hover();

    // ONE, not one per link: the widget is rendered for the hovered link
    // alone, so there is no invisible click target after every other link.
    await expect(button).toHaveCount(1);
  });

  test('can be reached with the pointer and opens the editor on its own link', async ({ page }) => {
    const editor = await seed(page);
    await editor.getByText('style guide').hover();

    // Travelling from the link text onto the button is the gesture that fails
    // if the reveal is a CSS `:hover` rule — leaving the text hides the thing
    // you are reaching for.
    const button = page.locator('.bear-link-edit button');
    await button.hover();
    await expect(button).toHaveCount(1);
    await button.click();

    const menu = page.locator('form:has(input[inputmode="url"])');
    await expect(menu).toBeVisible();
    // The SECOND link's address, not the first: the pencil edits the link it
    // belongs to, which a selection-based lookup would get wrong whenever the
    // caret and the pointer are on different links.
    await expect(menu.locator('input').first()).toHaveValue('https://style.test');
  });

  test('appears from the caret alone, with the pointer elsewhere', async ({ page }) => {
    const editor = await seed(page);

    await editor.getByText('CommonMark').click();
    await page.mouse.move(5, 500);

    await expect(page.locator('.bear-link-edit button')).toHaveCount(1);
  });

  test('revealing it does not move the line', async ({ page }) => {
    // The whole reason the holder is zero-width. Reserving space would make
    // the rest of the line jump sideways every time the pointer crossed a
    // link.
    const editor = await seed(page);
    const after = editor.getByText('for the spec', { exact: false }).first();
    const before = await after.boundingBox();

    await editor.getByText('CommonMark').hover();
    await expect(page.locator('.bear-link-edit button')).toHaveCount(1);

    expect(await after.boundingBox()).toEqual(before);
  });

  test('a link still opens its URL on click', async ({ page }) => {
    const editor = await seed(page);

    // Awaited as an EVENT, not read after a click: the popup arrives on its
    // own schedule and an immediate assertion sees an empty array — which
    // looks exactly like the affordance having broken the link.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      editor.getByText('CommonMark').click(),
    ]);

    expect(popup.url()).toBe('https://commonmark.org/');
  });
});
