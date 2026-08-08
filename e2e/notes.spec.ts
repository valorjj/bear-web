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

test('switching between notes never flashes the empty state', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('Alpha note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();
  await expect(page.getByRole('button', { name: /Alpha note/ })).toBeVisible();

  // Creating is async, and "New note" does not auto-focus the fresh textarea:
  // a real user cannot type until the blank box they clicked into actually
  // exists, but a script can outrun it and fill the *previous* note's still-
  // mounted textarea instead. Waiting for the value to go blank is the
  // equivalent of that human "there's nothing to click yet" gate.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Note text' }).fill('Beta note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();
  await expect(page.getByRole('button', { name: /Beta note/ })).toBeVisible();

  const alphaRow = page.getByRole('button', { name: /Alpha note/ });
  const betaRow = page.getByRole('button', { name: /Beta note/ });

  await alphaRow.click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('Alpha note');

  // Record every mutation of the editor pane's text while switching
  // selection, rather than sampling per animation frame: a MutationObserver
  // fires synchronously with the DOM change and cannot miss a one-frame
  // flash the way a rAF poll can.
  await page.evaluate(() => {
    // `Pane` is a plain `<section aria-label="…">`; the "region" role is
    // implicit (from being an accessible-name-bearing landmark), not a
    // literal `role` attribute, so it must be found via `aria-label`.
    const region = document.querySelector('section[aria-label="Editor"]');
    if (!region) throw new Error('editor region not found');

    const w = window as unknown as { __flashes: string[]; __editorObserver: MutationObserver };
    w.__flashes = [];
    w.__editorObserver = new MutationObserver(() => {
      if (region.textContent?.includes('No note selected')) {
        w.__flashes.push(region.textContent ?? '');
      }
    });
    w.__editorObserver.observe(region, { childList: true, subtree: true, characterData: true });
  });

  await betaRow.click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('Beta note');

  const flashes = await page.evaluate(() => {
    const w = window as unknown as { __flashes: string[]; __editorObserver: MutationObserver };
    w.__editorObserver.disconnect();
    return w.__flashes;
  });

  expect(flashes).toEqual([]);
});
