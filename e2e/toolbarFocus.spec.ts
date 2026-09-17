import { expect, test } from '@playwright/test';

/**
 * A formatting control must never hold the keyboard.
 *
 * The bug this pins: Tiptap's `focus()` command defers the real `view.focus()`
 * to a `requestAnimationFrame` (`@tiptap/core`'s `commands/focus.ts`), while
 * Chromium focuses a `<button>` synchronously on mousedown. Between the click
 * handler returning and the next frame, DOM focus is on the BUTTON — and a
 * `Space` or `Enter` in that window activates it again instead of reaching the
 * note.
 *
 * It cost an afternoon as a mystery: `footnotes.spec.ts`'s toolbar test failed
 * about half of all back-to-back full runs with three footnotes where one was
 * expected, and the text typed after the click missing entirely. Three native
 * `click` events reached the button from one mouse click — the first with
 * `detail: 1` at real coordinates, then two with `detail: 0` at `0,0`, which
 * is what a keyboard activation looks like. "Typed straight in." contains
 * exactly two spaces.
 *
 * Deterministic BY CONSTRUCTION rather than by being fast enough: the tests
 * below stub `requestAnimationFrame` to never call back, which freezes the
 * app in exactly the window the race opens. With focus taken on mousedown
 * the button then holds it forever and both assertions fail; with mousedown
 * defaulted away, focus never leaves the editor and the frozen frame changes
 * nothing. Neither test can pass for timing reasons.
 */

async function noteWithText(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Just a sentence.');
  await expect(editor).toContainText('Just a sentence.');
}

/** Freezes the window in which Tiptap has not yet taken focus back. */
async function freezeAnimationFrames(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
}

test('a toolbar button never takes the keyboard from the note', async ({ page }) => {
  await noteWithText(page);
  await freezeAnimationFrames(page);

  await page
    .getByRole('toolbar', { name: 'Formatting toolbar' })
    .getByRole('button', { name: 'Bold' })
    .click();

  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null),
    'focus stayed in the note, so the next keystroke is text',
  ).toBe('Note text');
});

test('a space typed straight after an insert is text, not a second insert', async ({ page }) => {
  await noteWithText(page);
  await freezeAnimationFrames(page);

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await page.getByRole('button', { name: 'Footnote', exact: true }).click();
  await expect(editor.locator('[data-footnote-def]')).toHaveCount(1);

  // The exact gesture that broke: keys pressed before the deferred focus has
  // landed. A space reaching the button activates it and inserts a second
  // footnote; reaching the note it is simply a space.
  await page.keyboard.type('a b');

  await expect(editor.locator('[data-footnote-def]'), 'one click made one footnote').toHaveCount(1);
  await expect(editor).toContainText('a b');
});
