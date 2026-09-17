import { expect, test } from '@playwright/test';

/**
 * The editor is not on the first-paint path, and it still works.
 *
 * Asserted through the app's own flow rather than by reading the manifest:
 * a bundle assertion proves the chunk exists, not that a person can still
 * type into it, and this sub-project's whole risk is trading a working
 * editor for a smaller number.
 */
test('a note opens and is typeable after the editor loads lazily', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('Typed after a lazy mount.');
  await expect(editor).toContainText('Typed after a lazy mount.');
});

test('the note list paints before the editor chunk has loaded', async ({ page }) => {
  // Hold the editor chunk indefinitely. The list must still appear: that is
  // the entire point of the split, and it is only observable while the chunk
  // is outstanding.
  await page.route('**/assets/NoteEditor-*.js', async () => {
    // never fulfilled
    await new Promise(() => {});
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});
