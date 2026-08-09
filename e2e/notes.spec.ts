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

  const reopened = page.getByRole('textbox', { name: 'Note text' });
  await expect(reopened).toContainText('Groceries');
  await expect(reopened).toContainText('milk, bread, coffee');
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
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('');
  await page.getByRole('textbox', { name: 'Note text' }).fill('Beta note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();
  await expect(page.getByRole('button', { name: /Beta note/ })).toBeVisible();

  const alphaRow = page.getByRole('button', { name: /Alpha note/ });
  const betaRow = page.getByRole('button', { name: /Beta note/ });

  await alphaRow.click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('Alpha note');

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
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('Beta note');

  const flashes = await page.evaluate(() => {
    const w = window as unknown as { __flashes: string[]; __editorObserver: MutationObserver };
    w.__editorObserver.disconnect();
    return w.__flashes;
  });

  expect(flashes).toEqual([]);
});

test('markdown typed into the editor survives a reload, in the document and on disk', async ({
  page,
}) => {
  // The literal, never read back from the page. M2 shipped a persistence test
  // that compared a stale default against itself and passed with persistence
  // completely broken.
  const HEADING = 'Roasting notes';

  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByLabel('Note text');
  await editor.click();
  await editor.pressSequentially(`# ${HEADING}\n\nBeans rest for 24 hours.`);

  // The heading must be a real heading, not literal '# ' text.
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();

  // Wait for the debounced write to land in IndexedDB rather than racing it.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const request = indexedDB.open('bear-web');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const store = db.transaction('notes', 'readonly').objectStore('notes');
        const all = await new Promise<Array<{ text: string }>>((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result as Array<{ text: string }>);
          req.onerror = () => reject(req.error);
        });
        return all.map((note) => note.text).join('\n');
      }),
    )
    .toContain(`# ${HEADING}`);

  await page.reload();

  // Selection is ephemeral by design (see 'a note survives a reload' above),
  // so the note must be reopened by hand before its heading can render again.
  await page.getByRole('button', { name: new RegExp(HEADING) }).click();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
});

test('keyboard select-all (Ctrl/Cmd+A) then repeated checklist toggles do not grow the note', async ({
  page,
}) => {
  // Task 11 fixed a real content-corruption bug: with the whole document
  // selected, clicking a block-format toolbar button repeatedly grew the note
  // without bound instead of toggling off, because ProseMirror's AllSelection
  // never collapses to a fixed range. The fix (pinAllSelectionStep) was only
  // ever verified via editor.commands.selectAll() — a programmatic shortcut,
  // not the real user path. This test drives the actual keyboard shortcut.
  const WORD = 'Coffee';

  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByLabel('Note text');
  await editor.click();
  await editor.pressSequentially(WORD);

  // The real keyboard path — not a programmatic selectAll() command.
  await page.keyboard.press('ControlOrMeta+a');

  const checklist = page.getByRole('button', { name: 'Checklist' });

  const readStoredText = () =>
    page.evaluate(async () => {
      const request = indexedDB.open('bear-web');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db.transaction('notes', 'readonly').objectStore('notes');
      const all = await new Promise<Array<{ text: string }>>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as Array<{ text: string }>);
        req.onerror = () => reject(req.error);
      });
      return all.map((note) => note.text).join('\n');
    });

  // Toggle on, then off. Wait for the debounced write to land before reading
  // it back, so the baseline captured below is the settled, persisted value.
  await checklist.click();
  await checklist.click();
  await expect.poll(readStoredText).toContain(WORD);
  const afterTwo = await readStoredText();

  // Toggle on and off again. Four toggles must be indistinguishable from two:
  // that is the property the corrupting bug violated (it kept growing on
  // every click instead of settling back to the same state).
  await checklist.click();
  await checklist.click();
  await expect.poll(readStoredText).toBe(afterTwo);
  const afterFour = await readStoredText();

  expect(afterFour).toBe(afterTwo);

  // No accumulating empty checklist items in the rendered document either —
  // four toggles ends on an even (off) count, so no list markup should remain.
  await expect(editor.locator('li')).toHaveCount(0);
});
