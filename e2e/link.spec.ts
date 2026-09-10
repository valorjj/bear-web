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
