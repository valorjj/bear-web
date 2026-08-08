import { expect, test } from '@playwright/test';

// A literal, defined here and never read back from the page before the
// assertion. M2 shipped a persistence test that compared a value read out of
// the page against itself, so it passed with persistence completely broken.
const NOTE_TEXT = 'Groceries\nmilk, bread, coffee';

test('a note survives a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.fill(NOTE_TEXT);
  await editor.blur();

  // The row appearing proves the write reached IndexedDB: the list is driven
  // by a live query, not by local state.
  await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region')).toHaveCount(3);

  // Selection is ephemeral by design, so the note must be reopened by hand.
  await page.getByRole('button', { name: /Groceries/ }).click();

  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue(NOTE_TEXT);
});

test('a deleted note can be found in the trash and restored', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill(NOTE_TEXT);
  await editor.blur();

  const row = page.getByRole('button', { name: /Groceries/ });
  await expect(row).toBeVisible();

  await row.click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toBeHidden();

  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(row).toBeVisible();

  await row.click();
  await page.getByRole('button', { name: 'Restore' }).click();

  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(row).toBeVisible();
});

test('a note the user never typed into is discarded', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.fill(NOTE_TEXT);
  await editor.blur();
  await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();

  // A second note, left completely empty. Matched by regex, not an exact
  // name: a row's accessible name is its title, date, and snippet run
  // together, so an exact match on 'Untitled' never resolves.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('button', { name: /Untitled/ })).toBeVisible();

  await page.getByRole('button', { name: /Groceries/ }).click();

  await expect(page.getByRole('button', { name: /Untitled/ })).toBeHidden();

  // Scoped to the note-list region: `ScopeSidebar` renders its two rows
  // ('Notes', 'Trash') as `<li>` too, so an unscoped `listitem` query would
  // count those alongside the note rows and never reach 1.
  const noteList = page.getByRole('region', { name: 'Note list' });
  await expect(noteList.getByRole('listitem')).toHaveCount(1);
});
