import { expect, test } from '@playwright/test';

/**
 * Task 5 of sub-project H: clicking into highlighted text pops the colour
 * palette anchored at that text, rather than requiring a trip to the bottom
 * toolbar. Covers only what no unit test can — real geometry and the
 * palette's real show/hide behaviour as the caret moves in and out of a mark.
 */

async function highlightWord(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('plain marked plain');
  await expect(editor).toContainText('plain marked plain');

  // Keyboard selection of the middle word, rather than a pointer double-click:
  // `getByText('marked')` resolves to the whole paragraph (its only text
  // node), so a click lands wherever Playwright centres THAT bounding box,
  // not on the word itself.
  //
  // A fresh `.click()` right before the keyboard sequence, not reused from
  // above: the seeded note remounts once it first acquires an id, and
  // `editorAffordances.spec.ts` documents that a keyboard sequence sent while
  // that remount is in flight silently lands on nothing — the same shape of
  // race, not a new one.
  const paragraph = page.locator('.ProseMirror > p').first();
  await paragraph.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 'plain '.length; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  for (let i = 0; i < 'marked'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('marked');

  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(1);
}

test('the highlight palette follows the caret into and out of a highlight', async ({ page }) => {
  await highlightWord(page);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  // The caret is still inside the mark right after applying it.
  await expect(palette).toBeVisible();

  // Click outside the mark. `plain marked plain` is one paragraph with a
  // single text run either side of the `<mark>`, so a plain `getByText`
  // click would centre on the whole paragraph — which sits ON the mark; a
  // position near the paragraph's own left edge unambiguously lands on the
  // leading "plain" instead.
  const paragraph = page.locator('.ProseMirror > p').first();
  await paragraph.click({ position: { x: 4, y: 6 } });
  await expect(palette).toBeHidden();

  // click back into the highlighted word — the mark is its own element, so
  // clicking it directly is unambiguous.
  const mark = page.locator('.ProseMirror mark');
  await mark.click();
  await expect(palette).toBeVisible();

  const markBox = await mark.boundingBox();
  const paletteBox = await palette.boundingBox();
  expect(markBox).not.toBeNull();
  expect(paletteBox).not.toBeNull();
  // Anchored above its own text, horizontally centred on it.
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(markBox!.y + 4);
});

test('choosing a colour recolours without moving the caret, and remove clears the mark', async ({
  page,
}) => {
  await highlightWord(page);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  await expect(palette).toBeVisible();

  await palette.getByRole('menuitemradio', { name: 'Green' }).click();
  await expect(page.locator('.ProseMirror mark.hl-green')).toHaveText('marked');
  // The palette stays up: the caret never left the mark.
  await expect(palette).toBeVisible();

  await palette.getByRole('button', { name: 'Remove highlight' }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText(
    'plain marked plain',
  );
});
