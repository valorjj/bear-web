import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The link address popover, in a real browser.
 *
 * What it replaced was `window.prompt`, which no Playwright assertion can
 * inspect at all — a native dialog is not in the page — so the only coverage
 * the old flow had was a jsdom test spying on `window.prompt`. The behaviour
 * below could not have been written before this change existed.
 */
async function noteWithWord(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.pressSequentially('Linkable');
}

function linkButton(page: Page) {
  return page.getByRole('toolbar', { name: 'Formatting toolbar' }).getByRole('button', {
    name: 'Link',
  });
}

test('the address is asked for in the page, not by the browser', async ({ page }) => {
  await noteWithWord(page);

  // A native `prompt` would BLOCK here and time the test out; Playwright
  // auto-dismisses dialogs, so the assertion that matters is that a real
  // element appeared in the document.
  await linkButton(page).click();

  await expect(page.getByRole('textbox', { name: 'Link address' })).toBeVisible();
  await expect(linkButton(page)).toHaveAttribute('aria-expanded', 'true');
});

test('a typed address links the selection, and Enter is enough', async ({ page }) => {
  await noteWithWord(page);
  await page.keyboard.press('ControlOrMeta+a');

  await linkButton(page).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('https://example.com');
  await page.keyboard.press('Enter');

  const anchor = page.locator('.ProseMirror a');
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toHaveAttribute('href', 'https://example.com');
  await expect(anchor).toHaveText('Linkable');
});

test('a bare host gains a scheme rather than resolving against this site', async ({ page }) => {
  await noteWithWord(page);
  await page.keyboard.press('ControlOrMeta+a');

  await linkButton(page).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('example.com');
  await page.keyboard.press('Enter');

  // Without the scheme the browser resolves this RELATIVE to the app, so the
  // href would read `http://localhost:4173/example.com` — a link that looks
  // right in the editor and 404s for anyone who follows it.
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com');
});

test('dismissing leaves an existing link exactly as it was', async ({ page }) => {
  await noteWithWord(page);
  await page.keyboard.press('ControlOrMeta+a');
  await linkButton(page).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('https://example.com');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);

  // Reopen on the existing link and back out. `window.prompt` returned null
  // here and the old handler read that as "unset the link", so this exact
  // gesture destroyed it.
  await page.locator('.ProseMirror a').click();
  await linkButton(page).click();
  await expect(page.getByRole('textbox', { name: 'Link address' })).toHaveValue(
    'https://example.com',
  );
  await page.keyboard.press('Escape');

  await expect(page.locator('.ProseMirror a')).toHaveCount(1);
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com');
});

/**
 * Anchored to the CARET, not parked above the toolbar.
 *
 * Asserted as a distance from the selection rather than as "is visible":
 * the popover was visible in its old placement too, so only a value that
 * moves with the behaviour can tell the two apart. The toolbar floats at the
 * bottom of the pane, so a popover still living in its column would sit
 * hundreds of pixels below a selection made in the first line.
 */
test('the popover opens at the selection, not above the toolbar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Anchor me here');

  // A SHORT note on purpose. An earlier version typed twelve filler
  // paragraphs to "push the toolbar away" — unnecessary, because the toolbar
  // floats at the bottom of the PANE whatever the note contains, and
  // actively harmful: it made the editor scrollable, clicking the toolbar
  // button scrolled it by 52px between the two measurements, and that
  // presented as a 56px placement error that did not exist.
  const scrollTop = await page
    .locator('section[aria-label]')
    .last()
    .evaluate((el) => el.scrollTop);
  expect(scrollTop, 'the editor must not scroll, or the two rects are different frames').toBe(0);

  // A double-click selects one word. Read the rect BEFORE opening: once
  // focus moves into the popover's field, `window.getSelection()` reports
  // that input's own empty selection and returns a 0x0 rect — which sailed
  // through a "is the selection small" guard, since 0 is very small indeed.
  await page.locator('.ProseMirror > *').first().dblclick();
  const selection = await page.evaluate(() => {
    const range = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: range.top, bottom: range.bottom, height: range.height };
  });
  expect(selection.height, 'a real one-word selection was measured').toBeGreaterThan(8);

  await linkButton(page).click();
  const popover = page.getByRole('form', { name: 'Link address' });
  await expect(popover).toBeVisible();
  const box = (await popover.boundingBox())!;
  const toolbar = (await page.getByRole('toolbar', { name: 'Formatting toolbar' }).boundingBox())!;

  // Within a menu gap of the selection, below it or flipped above it.
  const gapFromSelection = Math.min(
    Math.abs(box.y - selection.bottom),
    Math.abs(box.y + box.height - selection.top),
  );
  expect(
    gapFromSelection,
    `popover at ${Math.round(box.y)}..${Math.round(box.y + box.height)}, selection at ${Math.round(selection.top)}..${Math.round(selection.bottom)}`,
  ).toBeLessThan(24);

  // And demonstrably NOT in the toolbar's column, which is the placement
  // this replaces — the failure mode a "is it visible" assertion cannot see.
  expect(
    Math.abs(box.y + box.height - toolbar.y),
    `popover bottom ${Math.round(box.y + box.height)}, toolbar top ${Math.round(toolbar.y)}`,
  ).toBeGreaterThan(100);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /**
   * The rule the 2026-09-10 audit produced: every new surface gets at least
   * one assertion at 390px, because 243 commits of features shipped after J3
   * with none.
   */
  test('the popover fits the screen and its field does not zoom iOS', async ({ page }) => {
    await noteWithWord(page);
    await page.keyboard.press('ControlOrMeta+a');
    await linkButton(page).click();

    const field = page.getByRole('textbox', { name: 'Link address' });
    await expect(field).toBeVisible();

    const box = (await field.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    // iOS Safari zooms the page when a focused input is under 16px and leaves
    // no way back but pinching. `SearchField` carries the same rule.
    await expect(field).toHaveCSS('font-size', '16px');
  });

  test('the image picker is reachable in the scrolling strip', async ({ page }) => {
    await noteWithWord(page);
    const button = page
      .getByRole('toolbar', { name: 'Formatting toolbar' })
      .getByRole('button', { name: 'Insert image' });

    // `scrollIntoViewIfNeeded`, because the strip scrolls by design at this
    // width — 14 controls do not fit 390px and are not meant to. What must
    // hold is that the control is REACHABLE, and 44px of real ink once it is.
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();

    const box = (await button.boundingBox())!;
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  });
});
