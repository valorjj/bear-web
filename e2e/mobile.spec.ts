import { expect, test } from '@playwright/test';

const PHONE = { width: 390, height: 844 };

/**
 * Seven existing assertions that the shell has three panes depend on the
 * configured Playwright viewport being at or above the desktop breakpoint:
 * `codePalette.spec.ts:19,39,107`, `contrast.spec.ts:138`, and
 * `appearance.spec.ts:302,418,901`.
 *
 * Lowering `playwright.config.ts`'s viewport below 1024 turns all seven into
 * confusing failures about missing panes. This one fails honestly instead, and
 * says what to do about it.
 */
test('the configured desktop viewport is at or above the desktop breakpoint', async ({ page }) => {
  expect(page.viewportSize()!.width).toBeGreaterThanOrEqual(1024);
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  /** A note with real text, left saved and deselected on the list screen. */
  async function seedNote(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.fill('Groceries\nmilk, bread, coffee');
    await editor.blur();
    await page.getByRole('button', { name: 'Back to notes' }).click();
    await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
  }

  test('every rendered pane lies inside the viewport', async ({ page }) => {
    // The defect that started J1: at 390px the three panes laid out wider than
    // the screen and the editor sat entirely off it, so a phone user could tap
    // a note and never see one.
    //
    // NOT asserted through `document.scrollWidth`, which was the obvious
    // choice and is VACUOUS here: `<main>` carries `overflow-hidden`, so the
    // overflow is clipped and `scrollWidth` reads 390 whether the panes fit or
    // not. That is the very reason the original bug was invisible — the page
    // could not even be scrolled to reach what was off-screen.
    //
    // What reproducing it took is worth recording, because two plausible
    // injections do NOT reproduce it. Rendering all three panes on a phone
    // passes: `<main>` is a flex row, so `flex-1` panes simply shrink to 43px
    // each — useless, but on-screen. Giving the list a fixed width alone
    // passes too: 320px fits inside 390. Only BOTH together reproduce it,
    // because a `shrink-0` sidebar plus a `shrink-0` list exceed the viewport
    // and push what follows off the edge — which is exactly the shape of the
    // original defect. Under that injection this reads
    // "Note list ends off-screen — 592".
    await seedNote(page);

    const boxes = await page.locator('section[aria-label]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { label: node.getAttribute('aria-label'), left: rect.left, right: rect.right };
      }),
    );

    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left, `${box.label} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.label} ends off-screen`).toBeLessThanOrEqual(PHONE.width);
    }
  });

  test('opening a note replaces the list, and back returns to it', async ({ page }) => {
    await seedNote(page);

    await page.getByRole('button', { name: /Groceries/ }).click();

    await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText('milk, bread');
    // The list is GONE, not merely behind something — that is the whole
    // difference from the desktop layout.
    await expect(page.getByRole('button', { name: /Groceries/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to notes' }).click();

    await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
  });

  test('the back GESTURE returns from the editor, not just the back control', async ({ page }) => {
    // Android's hardware back and iOS's edge-swipe both drive popstate. This
    // is the only reason `useOverlayHistory` exists, and the first thing
    // anyone tries on a phone.
    await seedNote(page);
    await page.getByRole('button', { name: /Groceries/ }).click();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();

    await page.goBack();

    await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
  });

  test('the drawer opens the tag tree, filters the list, and closes itself', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.fill('Groceries #shopping\nmilk');
    await editor.blur();
    await page.getByRole('button', { name: 'Back to notes' }).click();

    await page.getByRole('button', { name: 'Show tags' }).click();
    const drawer = page.getByRole('dialog', { name: 'Tags and lists' });
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: /shopping/ }).click();

    // Closing is the point: the list the user just filtered is behind it.
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: /List options: shopping/ })).toBeVisible();
  });

  test('the back gesture closes the drawer instead of leaving the app', async ({ page }) => {
    await seedNote(page);

    await page.getByRole('button', { name: 'Show tags' }).click();
    const drawer = page.getByRole('dialog', { name: 'Tags and lists' });
    await expect(drawer).toBeVisible();

    await page.goBack();

    await expect(drawer).toBeHidden();
    // Still in the app, on the list — not navigated away.
    await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
  });

  test('the floating button creates a note and opens it', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'New note' }).click();

    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to notes' })).toBeVisible();
  });

  test('the search input is 16px, which is what stops iOS zooming on focus', async ({ page }) => {
    await seedNote(page);

    await page.getByRole('button', { name: 'Show search' }).click();

    // The COMPUTED size, not a class name. `--bear-text-ui` is 13px and Safari
    // zooms the page when an input below 16px takes focus; a class assertion
    // cannot see a token that changed underneath it.
    await expect(page.getByRole('searchbox')).toHaveCSS('font-size', '16px');
  });

  test('no resizer is rendered, so none is in the tab order', async ({ page }) => {
    await seedNote(page);

    // `toHaveCount(0)`, not "is hidden": a `display: none` separator would
    // still be a focusable stop announcing itself to assistive tech.
    await expect(page.getByRole('separator')).toHaveCount(0);
  });
});

test.describe('on a tablet', () => {
  test.use({ viewport: { width: 834, height: 1112 }, hasTouch: true });

  test('shows the list and the editor together, with the sidebar in a drawer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.fill('Groceries\nmilk');
    await editor.blur();

    // Both visible at once — the difference from the phone.
    await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(page.locator('section[aria-label]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Show tags' })).toBeVisible();
  });
});

test.describe('on a narrow desktop', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('dragging both panes wide leaves the editor at least its minimum width', async ({
    page,
  }) => {
    // Makes `SHELL_CHROME_WIDTH` falsifiable rather than merely asserted: it
    // is a constant, and if the shell's padding or gaps ever change, this is
    // what fails.
    await page.goto('/');
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    for (const name of ['Resize the sidebar', 'Resize the note list']) {
      const resizer = page.getByRole('separator', { name });
      const box = (await resizer.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(1024, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
    }

    const editor = page.getByRole('region', { name: 'Editor' });
    const box = (await editor.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(160);
  });
});

test.describe('phone header proportions', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the bar and its controls are touch-sized, measured not asserted', async ({ page }) => {
    // Computed boxes, not class names: this shipped as a 36px bar with 28px
    // controls and looked wrong on a real iPhone while every unit test passed.
    await page.goto('/');

    const menu = page.getByRole('button', { name: 'Show tags' });
    const search = page.getByRole('button', { name: 'Show search' });

    for (const control of [menu, search]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // The bar itself has to be tall enough to hold them with breathing room.
    const bar = page.locator('.h-14').first();
    expect((await bar.boundingBox())!.height).toBe(56);
  });

  test('the scope title is centred on the bar', async ({ page }) => {
    await page.goto('/');

    const title = page.getByRole('button', { name: /List options/ });
    const box = (await title.boundingBox())!;
    const centre = box.x + box.width / 2;

    // Within a couple of pixels of the viewport's centre. A flex layout with
    // `ml-auto` puts it wherever the left group ends, which drifts with the
    // scope name's length — this is what catches that.
    expect(Math.abs(centre - PHONE.width / 2)).toBeLessThanOrEqual(2);
  });
});
