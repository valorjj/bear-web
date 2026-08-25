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

test('the palette flips below the highlight when there is no room above it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');

  // Enough padding above AND below the target line that the mark can be
  // scrolled to sit in the very top band of the viewport with real content
  // on both sides — this is the case R8's screenshot review found broken:
  // the palette anchors ABOVE by default, and a highlight scrolled into the
  // top band leaves it with no room there at all.
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.type(`Padding line ${i} above the highlight.`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('plain marked plain');
  await page.keyboard.press('Enter');
  // Well more than enough below that the pane's max scroll position is not
  // the limiting factor — with only as much content below as above, the
  // container was already scrolled to its ceiling once typing finished, and
  // no further scroll (in either direction) could move the mark at all.
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.type(`Padding line ${i} below the highlight.`);
    await page.keyboard.press('Enter');
  }

  // Typing 60 padding lines below auto-scrolled the pane to keep the caret
  // in view, so "marked" is off-screen (a raw `mouse.click` at its real
  // coordinates would land outside the window and select nothing). Scroll it
  // into view before locating it.
  await page
    .locator('.ProseMirror > p', { hasText: 'plain marked plain' })
    .scrollIntoViewIfNeeded();

  // Locate "marked" by its own text node/`Range` and click there directly,
  // rather than walking character counts from `Home` after a paragraph
  // click: with 15 padding lines above it, the target line is off-screen
  // until the click auto-scrolls it into view, and the caret can land in the
  // wrong paragraph if that scroll is still settling when `Home` fires.
  const wordRect = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector('.ProseMirror')!,
      NodeFilter.SHOW_TEXT,
    );
    let node: Text | null;
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf('marked') ?? -1;
      if (idx !== -1 && node.textContent === 'plain marked plain') {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'marked'.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
  expect(wordRect).not.toBeNull();
  await page.mouse.click(wordRect!.x + wordRect!.width / 2, wordRect!.y + wordRect!.height / 2, {
    clickCount: 2,
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('marked');

  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(1);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  await expect(palette).toBeVisible();

  // Scroll the pane until the mark sits 10px from the top of the viewport —
  // the band where an above-anchored palette has no room and must flip
  // below instead. The scrollable element is the `overflow-auto` wrapper
  // `EditorContent` renders, not `.ProseMirror` itself.
  const scrollContainer = page.locator('.overflow-auto').first();
  await scrollContainer.evaluate((el, targetTop) => {
    const markEl = el.querySelector('mark');
    if (markEl === null) throw new Error('mark not found during scroll setup');
    el.scrollTop += markEl.getBoundingClientRect().top - targetTop;
    // A native scroll fires this asynchronously (typically batched to the
    // next frame): the DOM's own `scrollTop` reads back correctly right
    // away, but the app's `scroll`-listener-driven re-measurement has not
    // necessarily run yet, so a `boundingBox()` read immediately after can
    // observe the position from BEFORE this scroll. Dispatching the event
    // ourselves makes the capture listener on `window` run synchronously
    // (capture-phase listeners fire regardless of `bubbles`), so the
    // assertion below observes the settled result rather than racing it.
    el.dispatchEvent(new Event('scroll'));
  }, 10);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  // Fully within the viewport — not clipped off the top edge.
  const paletteBox = await palette.boundingBox();
  expect(paletteBox).not.toBeNull();
  expect(paletteBox!.y).toBeGreaterThanOrEqual(0);
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(viewport!.height);
});
