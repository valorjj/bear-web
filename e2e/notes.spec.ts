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

  // Scoped to the note-list region: `SmartListSidebar` renders its rows
  // ('Notes', 'Untagged', 'Todo', 'Today', 'Pinned', 'Locked', 'Trash') as
  // `<li>` too, so an unscoped `listitem` query would count those alongside
  // the note rows and never reach 1.
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

test('a tag typed into a note appears in the sidebar and filters the list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Sprint planning\n#work/urgent');
  await editor.blur();

  const tags = page.getByRole('navigation', { name: 'Tags' });
  await expect(tags.getByRole('button', { name: /^work\b/ })).toBeVisible();
  await expect(tags.getByRole('button', { name: /^urgent\b/ })).toBeVisible();

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).click();
  await page.keyboard.type('Groceries\n#home');
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  // Selecting the parent covers the descendant and excludes the other tag.
  // Scoped to the note-list region: a tag filter never deselects the note
  // still open in the editor (see CLAUDE.md), so an unscoped query would see
  // 'Groceries' lingering in the editor pane and fail for the wrong reason.
  const noteList = page.getByRole('region', { name: 'Note list' });
  await tags.getByRole('button', { name: /^work\b/ }).click();
  await expect(noteList.getByText('Sprint planning')).toBeVisible();
  await expect(noteList.getByText('Groceries')).toHaveCount(0);

  // Creating inside a tag scope seeds the tag, so the note stays in view.
  // The active scope here is 'work' (the parent tag clicked above), not the
  // leaf 'work/urgent', so that is what a new note is seeded with.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText('#work');
});

test('collapsing a tag hides its children and survives a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Sprint planning\n#work/urgent');
  await editor.blur();

  const tags = page.getByRole('navigation', { name: 'Tags' });
  const workRow = tags.getByRole('button', { name: /^work\b/ }).locator('xpath=ancestor::li[1]');

  await workRow.getByRole('button', { name: 'Expand or collapse' }).click();
  await expect(tags.getByRole('button', { name: /^urgent\b/ })).toHaveCount(0);

  await page.reload();
  await expect(tags.getByRole('button', { name: /^work\b/ })).toBeVisible();
  await expect(tags.getByRole('button', { name: /^urgent\b/ })).toHaveCount(0);
});

test('a note with an unchecked task appears in Todo, and leaves when checked', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // Typed, not filled: `[ ] ` is a Tiptap input rule and `fill` bypasses
  // input rules entirely, so the note would hold literal text and no task at
  // all — the predicate would still match, and the test would pass without
  // ever exercising a real checkbox. Typed with no leading `- `: TaskItem's
  // own input rule (`^\s*(\[([( |x])?\])\s$`) fires on `[ ] ` alone; typing
  // `- ` first hands the line to StarterKit's bulletList input rule instead,
  // so the task item never forms and `[ ] milk` is left as literal bullet
  // text. The editor still serializes the resulting task item to Markdown's
  // `- [ ] milk`, which is what `UNCHECKED_TASK` matches.
  await page.keyboard.type('[ ] milk');
  await editor.blur();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  const noteList = page.getByRole('region', { name: 'Note list' });

  await lists.getByRole('button', { name: /^Todo\b/ }).click();
  await expect(noteList.getByText('milk')).toBeVisible();

  // Checking it off removes it from Todo. This is the half a predicate test
  // cannot reach: it needs the real editor writing real Markdown.
  await noteList.getByText('milk').click();
  await page.getByRole('textbox', { name: 'Note text' }).getByRole('checkbox').check();
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  await expect(noteList.getByText('milk')).toHaveCount(0);
});

test('pinning floats a note to the top of the list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('First note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  // 'New note' does not auto-focus the fresh textarea (see 'switching between
  // notes never flashes the empty state' above), so a script can outrun it
  // and fill the still-mounted first note's textbox instead of the new blank
  // one. Waiting for it to go empty is the equivalent of a real user's "there
  // is nothing to click yet" gate.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('');
  await page.getByRole('textbox', { name: 'Note text' }).fill('Second note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  const noteList = page.getByRole('region', { name: 'Note list' });
  const rows = noteList.getByRole('listitem');

  // Newest first, so the second note leads.
  await expect(rows.first()).toContainText('Second note');

  await rows.filter({ hasText: 'First note' }).getByRole('button', { name: 'Pin note' }).click();

  await expect(rows.first()).toContainText('First note');
});

test('deleting a note forever removes it permanently across a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill('Doomed note');
  await editor.blur();

  await page.getByRole('button', { name: 'Delete' }).click();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  const noteList = page.getByRole('region', { name: 'Note list' });

  await lists.getByRole('button', { name: /^Trash\b/ }).click();
  await noteList.getByRole('button', { name: /Doomed/ }).click();

  // Only the toolbar button exists at this point, so the unscoped query is
  // unambiguous; once the dialog opens there are two, hence the scoping below.
  await page.getByRole('button', { name: 'Delete forever' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete forever' }).click();

  // Confirming dispatches the purge fire-and-forget; wait for the row to
  // actually leave the DOM before reloading, or the reload can race the
  // still-in-flight IndexedDB write and observe the note as if it were never
  // deleted at all.
  await expect(noteList.getByRole('button', { name: /Doomed/ })).toHaveCount(0);

  // The reload is the whole point: it proves the purge reached IndexedDB
  // rather than only the React tree. M2 shipped a persistence test that
  // compared a value read out of the page against itself and passed with
  // persistence completely broken.
  await page.reload();
  await expect(page.getByRole('region')).toHaveCount(3);
  await lists.getByRole('button', { name: /^Trash\b/ }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});

test('Cmd/Ctrl+F focuses the search field', async ({ page }) => {
  await page.goto('/');

  // Wait for the shell to actually be interactive before pressing the
  // shortcut — otherwise the keydown listener AppShell registers on mount
  // may not be attached yet, which would fail for a reason unrelated to the
  // shortcut itself.
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();

  // A real browser shortcut, arbitrated by the real page — jsdom has no
  // notion of "the browser's own find" to compete with, so this belongs
  // here rather than in a component test. `ControlOrMeta` presses Meta on
  // macOS and Control everywhere else, matching AppShell's own
  // `event.metaKey || event.ctrlKey` check.
  await page.keyboard.press('ControlOrMeta+f');

  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeFocused();
});

test('search narrows the list against real stored notes, and creating a note clears it', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  let editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Groceries\nmilk and bread');
  await editor.blur();

  await page.getByRole('button', { name: 'New note' }).click();
  editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Sprint planning\nstandup notes');
  await editor.blur();

  const noteList = page.getByRole('region', { name: 'Note list' });
  await expect(noteList.getByRole('button', { name: /Groceries/ })).toBeVisible();
  await expect(noteList.getByRole('button', { name: /Sprint planning/ })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search notes' });
  await search.fill('milk');

  await expect(noteList.getByRole('button', { name: /Groceries/ })).toBeVisible();
  await expect(noteList.getByRole('button', { name: /Sprint planning/ })).toHaveCount(0);

  // A note created under an active query would otherwise be invisible the
  // instant it exists.
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(search).toHaveValue('');
  await expect(noteList.getByRole('button', { name: /Untitled/ })).toBeVisible();
});

test('a modifier click on a tag pill filters by that tag, and does not move the caret', async ({
  page,
}) => {
  await page.goto('/');

  // An untagged note first, so the note list actually has something to
  // narrow away — a single-note list can't distinguish "filtered" from
  // "nothing changed".
  await page.getByRole('button', { name: 'New note' }).click();
  let editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Groceries');
  await editor.blur();

  await page.getByRole('button', { name: 'New note' }).click();
  editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Ship #work today');
  await editor.blur();

  const noteList = page.getByRole('region', { name: 'Note list' });
  await expect(noteList.getByText('Groceries')).toBeVisible();
  await expect(noteList.getByText('Ship #work today')).toBeVisible();

  const pill = editor.locator('.bear-tag');
  await expect(pill).toHaveText('#work');

  await pill.click({ modifiers: ['ControlOrMeta'] });

  // The user-visible half of the feature: the untagged note leaves the list
  // and the tagged one stays.
  await expect(noteList.getByText('Groceries')).toHaveCount(0);
  await expect(noteList.getByText('Ship #work today')).toBeVisible();

  // `SidebarRow`'s `current` prop defaults to `'page'`, and neither
  // `TagSidebar` nor `SmartListSidebar` override it, so a tag row's
  // `aria-current` is `'page'`, not `'true'` (that value is reserved for
  // `NoteListItem`'s note rows). The accessible name is "work" followed by a
  // trailing count, hence `/^work\b/` rather than an exact match.
  await expect(page.getByRole('button', { name: /^work\b/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // This milestone's named first risk: `preventDefault()` on mousedown must
  // stop the browser from placing the caret. Deliberately a single,
  // non-retrying `page.evaluate` read taken immediately after the click
  // resolves, not a `locator` assertion — ProseMirror rebuilds the `.bear-tag`
  // decoration on every transaction, so an auto-retrying assertion (e.g.
  // `expect(pill).toHaveCount(1)`) can straddle a redraw and observe the
  // settled state, missing a caret that moved and came back. The editor was
  // blurred above, so if the caret had moved into the tag, focus would have
  // returned to the contenteditable; if it did not, focus stays wherever the
  // click actually landed (the note-list button `document.activeElement`
  // ends up on after Playwright's click). Verified this discriminates: with
  // `event.preventDefault()` removed from the mousedown handler,
  // `document.activeElement` is the contenteditable `DIV` every time (3/3
  // runs); with it present, it never is (3/3 runs) — see task-5-fix-report.md.
  const activeAfterModClick = await page.evaluate(
    () => document.activeElement?.getAttribute('contenteditable') === 'true',
  );
  expect(activeAfterModClick).toBe(false);
});

// The invariant Task 6 established: a Mod-click either filters, or behaves
// exactly like a plain click. Never nothing. The app declines whenever the tag
// is absent from the index, and the plugin gates `preventDefault()` on that
// answer — so a declined gesture must still place the caret.
//
// A trashed note is the deterministic way to reach a declining pill from the
// UI alone: `noteTags` reflects active notes only, so the editor paints the
// pill (it knows nothing about trash) while the tag is genuinely not in the
// tree. The other two declining cases are a lying pill (needs Markdown the
// serializer will not produce from typing) and a tag typed inside the 300 ms
// autosave debounce (a race, not an assertion).
test('a modifier click on a tag the app declines places the caret instead of doing nothing', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Ship #work today');
  await editor.blur();

  await page.getByRole('button', { name: 'Delete' }).click();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: /^Trash\b/ }).click();
  await page
    .getByRole('region', { name: 'Note list' })
    .getByRole('button', { name: /Ship/ })
    .click();

  // The pill is painted even though the tag is not in the index — the editor
  // deliberately learns nothing about scopes.
  const pill = editor.locator('.bear-tag');
  await expect(pill).toHaveText('#work');

  await pill.click({ modifiers: ['ControlOrMeta'] });

  // The caret landed inside the tag, so suppression lifted the pill: the same
  // observable the plain-click test below uses, because the two gestures are
  // required to be indistinguishable here. Before this contract the plugin
  // called `preventDefault()` before asking, so the pill stayed, the caret
  // never moved and the scope never changed — the click simply vanished.
  await expect(pill).toHaveCount(0);
  // And it is still a decline, not a filter: no tag row exists for a trashed
  // note's tag, and Trash stays current.
  await expect(lists.getByRole('button', { name: /^Trash\b/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a plain click on a tag pill places the caret and does not filter', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Ship #work today');
  await editor.blur();

  await editor.locator('.bear-tag').click();

  // The caret landed in the tag, so its pill is suppressed — that is the
  // observable proof the click was an edit rather than an activation.
  await expect(editor.locator('.bear-tag')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Notes\b/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('typing "- [ ] " produces a real checkbox, not a literal bullet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // The full sequence a user types, including the leading "- " that hands the
  // line to StarterKit's bulletList rule first. That race is the defect.
  await page.keyboard.type('- [ ] milk');

  await expect(editor.getByRole('checkbox')).toBeVisible();
  await expect(editor).not.toContainText('[ ] milk');

  await editor.blur();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: /^Todo\b/ }).click();
  await expect(page.getByRole('region', { name: 'Note list' }).getByText('milk')).toBeVisible();
});
