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

test('the note list paints before the editor chunk has loaded, and the pane shows a loading state until it does', async ({
  page,
}) => {
  // Hold the editor chunk indefinitely. The list must still appear: that is
  // the entire point of the split, and it is only observable while the chunk
  // is outstanding.
  //
  // If the editor were still eager, `**/assets/NoteEditor-*.js` would match
  // no request at all — there would be no such chunk to hold — and this
  // route handler would simply never fire. A test that only asserted "New
  // note" is visible could not tell that apart from a genuine, held-open
  // split: it would pass either way. `chunkRequested` and the
  // `editor.loading` assertion below both depend on the block having
  // actually intercepted a real request, so either one failing here means
  // the block did nothing, not that the note list failed to paint.
  let chunkRequested = false;
  await page.route('**/assets/NoteEditor-*.js', async () => {
    chunkRequested = true;
    // never fulfilled
    await new Promise(() => {});
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();

  // Selecting a note is what actually triggers the mount attempt. With the
  // chunk held open, the pane must sit on the loading copy indefinitely
  // rather than ever reaching the real editor.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByText('Opening the note…')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note text' })).not.toBeVisible();

  expect(chunkRequested).toBe(true);
});
