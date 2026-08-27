import { expect, test } from '@playwright/test';

import { FIXED_NOW, type Corpus } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

const PHONE = { width: 390, height: 844 };

/**
 * One note carrying a heading and a table, which are the two editor surfaces
 * whose affordances J2 rests visible. Deliberately not `CORPUS`: these tests
 * assert geometry on specific widgets, and a fixture shared with the shot
 * harness would move under them.
 */
const TOUCH_CORPUS: Corpus = {
  notes: [
    {
      id: 'touch-1',
      title: 'Touch parity',
      // The leading plain title line matters: a note's FIRST block is its
      // title and is never foldable (`headingSections`' docblock), so a note
      // opening on `## Alpha` would carry no fold toggle at all.
      text: 'Touch parity\n\n## Alpha\n\nA paragraph.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'touch-2',
      title: 'Second note',
      text: 'Second note\n\nAnother one, so the list has two rows.\n',
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
  ],
  settings: [],
};

/**
 * A real long press, driven through CDP rather than synthesised.
 *
 * `page.touchscreen` offers `tap` and nothing else, and
 * `locator.dispatchEvent('pointerdown')` would be the same mistake as
 * `{ force: true }` in `e2e/pdfExport.spec.ts` — an event no user can produce,
 * which proves the handler runs but not that the gesture reaches it. CDP touch
 * input makes Chromium generate genuine `pointer` events with
 * `pointerType: 'touch'`, which is what `useLongPress` listens for.
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

test.describe('on a touch device', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await seedDatabase(page, TOUCH_CORPUS);
    await page.goto('/');
  });

  test('the note row’s pin rests visible', async ({ page }) => {
    // `toBeVisible()` is useless here and the reason is recorded in
    // `NoteListItem.tsx`: it ignores `opacity`, so it passes against the very
    // `opacity-0` this rule exists to override. Only a polled computed value
    // can see the difference.
    const pin = page.getByRole('button', { name: 'Pin note', exact: true }).first();
    await expect(pin).toHaveCSS('opacity', '1');
  });

  test('the heading fold gutter rests visible', async ({ page }) => {
    await page.getByRole('button', { name: /Touch parity/ }).click();
    const toggle = page.locator('.bear-fold-toggle').first();
    await expect(toggle).toHaveCSS('opacity', '1');
    await expect(page.locator('.bear-fold-badge').first()).toHaveCSS('opacity', '1');
  });

  test('the table’s edge handles rest visible', async ({ page }) => {
    await page.getByRole('button', { name: /Touch parity/ }).click();

    // The caret is placed by KEYBOARD, and neither `.click()` nor
    // `touchscreen.tap()` will do. Two separate traps sit here, and a fault
    // injection found both:
    //
    // - `.click()` drives the MOUSE, so it leaves the table hovered and
    //   `:has(+ table:hover)` matches with the resting rule deleted.
    // - a TAP is no better: Chromium applies STICKY `:hover` to the tapped
    //   element on a touch device and holds it until something else is
    //   tapped, so the hover rule matches there too.
    //
    // Both versions of this test passed against a build with
    // `@media (hover: none)` inverted. Arrowing in from the paragraph above
    // leaves no hover state anywhere near the table, so the resting rule is
    // the only thing that can make the handle visible.
    //
    // The handles are also gated on the CARET being inside the table, not on
    // a table existing — `tablePosAt(state)` returns null otherwise and the
    // layer is `DecorationSet.empty`. The `:hover` rule was a SECOND gate on
    // top of that one.
    const paragraph = page.locator('.ProseMirror p', { hasText: 'A paragraph.' });
    const paraBox = (await paragraph.boundingBox())!;
    await page.touchscreen.tap(paraBox.x + paraBox.width / 2, paraBox.y + paraBox.height / 2);
    await page.keyboard.press('ArrowDown');

    const handle = page.locator('.bear-table-handle').first();
    await expect(handle).toHaveCount(1);
    await expect(handle).toHaveCSS('opacity', '1');
  });

  test('a long press opens the row menu without selecting the row', async ({ page }) => {
    const row = page.getByRole('button', { name: /Touch parity/ });
    const box = (await row.boundingBox())!;
    await longPress(page, box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();

    // The click a touch produces after the press must not reach the row. On a
    // phone the row's click switches to the editor screen, so an unsuppressed
    // click would open this menu over a screen the user never asked for — the
    // note list must still be the thing underneath.
    await expect(row).toBeVisible();
  });

  test('a scroll does not open the row menu', async ({ page }) => {
    const row = page.getByRole('button', { name: /Touch parity/ });
    const box = (await row.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - 60 }],
    });
    await page.waitForTimeout(700);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();

    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the pin is tappable OUTSIDE its 22px ink', async ({ page }) => {
    // The behavioural form of the hit-area assertion. Asserting that a 44px
    // `::after` exists would pass against a rule that draws the box and never
    // receives a tap; tapping a point the ink does not cover and watching the
    // note's state change cannot.
    const pin = page.getByRole('button', { name: 'Pin note', exact: true }).first();
    const box = (await pin.boundingBox())!;
    expect(box.width).toBeLessThan(30); // the ink really is small

    // 8px above the ink's top edge — outside the button, inside the 44px zone.
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 8);

    await expect(
      page.getByRole('button', { name: 'Unpin note', exact: true }).first(),
    ).toBeVisible();
  });

  test('menu items are at least 44px tall', async ({ page }) => {
    const row = page.getByRole('button', { name: /Touch parity/ });
    const box = (await row.boundingBox())!;
    await longPress(page, box.x + box.width / 2, box.y + box.height / 2);

    const item = page.getByRole('menuitem', { name: 'Duplicate' });
    const itemBox = (await item.boundingBox())!;
    expect(itemBox.height).toBeGreaterThanOrEqual(44);
  });

  test('a toolbar button’s TARGET reaches 44px while its ink stays 28', async ({ page }) => {
    await page.getByRole('button', { name: /Touch parity/ }).click();
    await page.getByRole('textbox', { name: 'Note text' }).click();

    // Scoped to the strip. `Bold` appears in BOTH the top controls and the
    // formatting toolbar, so an unscoped `getByRole` is a strict-mode
    // violation that presents as "element not found".
    //
    // The TOP controls, deliberately. The bottom strip is `overflow-x-auto`,
    // which forces a non-visible `overflow-y` and clips the expansion to the
    // strip — see `BottomToolbar.tsx`, where the utility is deliberately
    // absent. This asserts the mechanism on the surface where it can work.
    const bold = page.getByRole('toolbar', { name: 'Top controls' }).getByRole('button', {
      name: 'Bold',
    });
    const box = (await bold.boundingBox())!;

    // The INK stays 28px: J2 does not reflow anything, which is J3's work.
    expect(box.height).toBeLessThan(32);
    await expect(bold).toHaveAttribute('aria-pressed', 'false');

    // ...and the target reaches 44 anyway. 6px above the ink is outside the
    // button and inside the 44px zone, so only a real hit area can make this
    // pass — an assertion that the `::after` merely EXISTS would pass against
    // a rule that draws the box and receives nothing.
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 6);
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('on a pointer device', () => {
  // No `hasTouch`, so `(hover: none)` and `(pointer: coarse)` are both false.
  // This block is what makes the rules above CONDITIONAL rather than
  // unconditional: without it, deleting every media query would leave the
  // touch suite green.
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await seedDatabase(page, TOUCH_CORPUS);
    await page.goto('/');
  });

  test('the note row’s pin stays hidden at rest', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Pin note', exact: true }).first()).toHaveCSS(
      'opacity',
      '0',
    );
  });

  test('the heading fold gutter stays hidden at rest', async ({ page }) => {
    await page.getByRole('button', { name: /Touch parity/ }).click();
    await expect(page.locator('.bear-fold-toggle').first()).toHaveCSS('opacity', '0');
  });

  test('a menu item keeps its compact height', async ({ page }) => {
    const row = page.getByRole('button', { name: /Touch parity/ });
    await row.click({ button: 'right' });
    const itemBox = (await page.getByRole('menuitem', { name: 'Duplicate' }).boundingBox())!;
    expect(itemBox.height).toBeLessThan(44);
  });
});
