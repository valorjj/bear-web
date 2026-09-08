import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * A real long press, driven through CDP rather than synthesised.
 *
 * Copied from `e2e/touch.spec.ts`'s own `longPress`: `page.touchscreen` only
 * offers `tap`, and a synthesised `pointerdown` (`locator.dispatchEvent`)
 * would be the same mistake as `{ force: true }` elsewhere in this suite — an
 * event no user can produce, which proves the handler runs but not that the
 * gesture reaches it. CDP touch input makes Chromium generate genuine
 * `pointer` events with `pointerType: 'touch'`, which is what `useLongPress`
 * listens for.
 */
async function longPress(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  ms = 700,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(ms);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

/**
 * The editor's contenteditable, located by its stable class rather than its
 * ARIA role — `role="textbox"` flips to `role="combobox"` for as long as the
 * tag autocomplete popover is open (`TagAutocomplete.ts`'s editable-combobox
 * pattern, the same one `LinkAutocomplete.ts` uses), which
 * `e2e/backlinks.spec.ts`'s own `editorLocator` already documents.
 */
function editorLocator(page: import('@playwright/test').Page) {
  return page.locator('.ProseMirror[contenteditable="true"]');
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, CORPUS);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
});

test('renaming a tag rewrites the notes and the scope follows', async ({ page }) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  await expect(sidebar.getByText('economy')).toBeVisible();

  // Scope onto the tag first: the point of the assertion below is that a
  // rename does not throw the user out to All Notes.
  await sidebar.getByRole('button', { name: /^economy/ }).click();

  await sidebar.getByRole('button', { name: /^economy/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename tag' }).click();

  const field = page.getByRole('textbox', { name: 'New tag name' });
  await field.fill('markets');
  await page.getByRole('button', { name: 'Rename' }).click();

  await expect(sidebar.getByRole('button', { name: /^markets/ })).toBeVisible();
  await expect(sidebar.getByText('economy')).toHaveCount(0);
  // The scope followed rather than resetting to All Notes.
  await expect(sidebar.getByRole('button', { name: /^markets/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // And the note's own text really changed — both the renamed tag and its
  // untouched sub-tag survive the rewrite.
  await page.getByRole('button', { name: /US market daily/ }).click();
  const editor = page.getByRole('region', { name: 'Editor' });
  await expect(editor).toContainText('markets/us-market');
  await expect(editor).toContainText('markets/rates');
});

test('deleting a tag asks first, states the real note count, then strips it from the notes', async ({
  page,
}) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  await expect(sidebar.getByText('dev')).toBeVisible();

  await sidebar.getByRole('button', { name: /^dev/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete tag' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveText(/Delete this tag\?/);
  // `#dev` carries no sub-tags and sits on two notes in the corpus
  // (`CODE_NOTE`, `SYNTAX_NOTE`) — the `flatMany` body, stated with the real
  // count rather than a placeholder.
  await expect(confirm).toContainText(
    'It will be removed from 2 notes. The notes themselves are kept.',
  );
  await expect(sidebar.getByText('dev')).toBeVisible();

  await confirm.getByRole('button', { name: 'Delete tag' }).click();

  await expect(sidebar.getByText('dev')).toHaveCount(0);
});

test('the menu is reachable by keyboard alone', async ({ page }) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  const row = sidebar.getByRole('button', { name: /^dev/ });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Tag actions' })).toBeVisible();
});

test('the tag autocomplete completes and descends', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = editorLocator(page);
  await editor.click();

  // A real caret and a real Tab keypress — neither belongs in jsdom. The
  // `openFrom` gate (`TagAutocomplete.ts`) only opens the list on a document
  // change, so it must be TYPED open, never placed by a click.
  await page.keyboard.type('Notes #eco');
  const list = editor.getByRole('listbox', { name: 'Tag' });
  await expect(list).toBeVisible();
  // Row 0 is always the literal text just typed, not the highest-ranked
  // existing tag — the corpus's `#economy/us-market` and `#economy/rates`
  // rank below it.
  await expect(list.getByRole('option').first()).toHaveText('eco');
  await expect(list.getByRole('option')).toContainText(['eco', 'economy']);

  // Move onto the existing `economy` row and accept it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');

  // Descended: the tag committed as `#economy`, the caret stayed parked at
  // its end with no trailing space, and the popover reopened on that tag's
  // own subtree rather than closing.
  await expect(editor).toContainText('Notes #economy');
  await expect(list).toBeVisible();
  await expect(list.getByRole('option')).toContainText(['economy', 'economy/rates']);

  // A space commits and closes at any depth.
  await page.keyboard.type('/us-market');
  await page.keyboard.press('Space');
  await expect(list).toHaveCount(0);
  await expect(editor).toContainText('Notes #economy/us-market');
});

test('a plain click on a tag pill re-scopes the note list', async ({ page }) => {
  await page.getByRole('button', { name: /US market daily/ }).click();
  const editor = editorLocator(page);
  const pill = editor.locator('.bear-tag', { hasText: 'economy/rates' });
  await expect(pill).toBeVisible();

  await pill.click();

  // The note-list scope header itself, not merely "some notes changed": its
  // accessible name is `t('noteList.menu.open')` with the scope name
  // substituted in, and its visible text is the bare tag key.
  const scopeButton = page.getByRole('button', { name: 'List options: economy/rates' });
  await expect(scopeButton).toBeVisible();
  await expect(scopeButton).toHaveText('economy/rates');
});

test.describe('on a touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a long press opens the tag menu, and Rename through it lands', async ({ page }) => {
    // The sidebar is a drawer at this width; open it the way `e2e/mobile.spec.ts`
    // does — its control's accessible name is "Show tags", not "Sidebar".
    await page.getByRole('button', { name: 'Show tags' }).click();
    const drawer = page.getByRole('dialog', { name: 'Tags and lists' });
    await expect(drawer).toBeVisible();

    const row = drawer.getByRole('button', { name: /^dev/ });
    const box = (await row.boundingBox())!;
    await longPress(page, box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByRole('menu', { name: 'Tag actions' })).toBeVisible();

    // The assertion above is NOT enough on its own, and this test shipped with
    // only that one. `toBeVisible()` checks the bounding box and `visibility`
    // and never OCCLUSION: below desktop the tag tree lives inside
    // `SidebarDrawer`'s `Dialog` (`fixed inset-0 z-50`) while both overlays are
    // rendered as siblings of it, so at `z-20` the menu painted UNDERNEATH the
    // drawer and its backdrop — visible to Playwright, unreachable by a finger,
    // and the first tap landed on the backdrop and closed everything. The whole
    // touch route was dead while this test was green. Only OPERATING the menu
    // can tell the two apart, so it now drives Rename end to end.
    await page.getByRole('menuitem', { name: 'Rename tag' }).click();

    const field = page.getByRole('textbox', { name: 'New tag name' });
    await field.fill('devops');
    await page.getByRole('button', { name: 'Rename' }).click();

    await expect(drawer.getByRole('button', { name: /^devops/ })).toBeVisible();
    await expect(drawer.getByText('dev', { exact: true })).toHaveCount(0);
  });
});
