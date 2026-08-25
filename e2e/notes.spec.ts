import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

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

test('exporting a note downloads its Markdown verbatim, and its HTML as a real document', async ({
  page,
}) => {
  // The only place the download path can be exercised: jsdom implements neither
  // object URLs nor `<a download>`, so `downloadBlob`'s unit test can prove the
  // anchor is built and clicked but not that a browser actually saves a file.
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('# Export me');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('Body text with a #tag');
  await page.keyboard.press('Enter');
  // A task item, because the export's own rendering is checked below and a
  // checkbox beside its label is the assertion that catches a missing reset.
  await editor.pressSequentially('- [ ] a task');
  await expect(editor.locator('ul[data-type="taskList"]')).toBeVisible();

  const openMenu = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Export note' }).click();
    await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
  };

  await openMenu();
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Markdown' }).click();
  const markdown = await markdownDownload;

  // Named from the note's own title, and carrying exactly what is on screen —
  // including the last keystrokes, which the stored record has not seen yet
  // because the autosave debounce has not elapsed.
  expect(markdown.suggestedFilename()).toBe('Export me.md');
  const markdownPath = await markdown.path();
  const markdownText = await readFile(markdownPath, 'utf8');
  expect(markdownText).toContain('# Export me');
  expect(markdownText).toContain('Body text with a #tag');
  expect(markdownText).toContain('- [ ] a task');

  await openMenu();
  const htmlDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'HTML' }).click();
  const html = await htmlDownload;

  expect(html.suggestedFilename()).toBe('Export me.html');
  // Saved under a real `.html` name before it is loaded below: Playwright's own
  // download path has no extension, and Chromium then serves it as plain text
  // rather than rendering it, so every geometry assertion would find nothing.
  const htmlPath = join(tmpdir(), 'bear-web-export-test.html');
  await html.saveAs(htmlPath);
  const htmlText = await readFile(htmlPath, 'utf8');
  expect(htmlText.startsWith('<!doctype html>')).toBe(true);
  expect(htmlText).toContain('<h1>Export me</h1>');
  // Self-contained: the token values are resolved into the file, so it renders
  // the same on a machine that has never seen this app.
  expect(htmlText).toMatch(/--bear-text:\s*\S/);
  expect(htmlText).not.toMatch(/https?:\/\//);

  // And it has to RENDER, which is a different question from whether its markup
  // is right. The exported document carries no Tailwind preflight, so the
  // browser default `p { margin: 1em 0 }` applies inside a flex task item and
  // stacks the checkbox above its text — markup-perfect, visibly broken, and
  // invisible to every assertion above. Same shape as the task-item test in
  // `appearance.spec.ts`, asked of the export instead of the editor.
  await page.goto(`file://${htmlPath}`);
  const item = await page.evaluate(() => {
    const row = document.querySelector('ul[data-type="taskList"] li');
    const box = row?.querySelector('input[type="checkbox"]');
    const text = row?.querySelector('p');
    if (row == null || box == null || text == null) return null;

    return {
      height: row.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight),
      boxRight: box.getBoundingClientRect().right,
      textLeft: text.getBoundingClientRect().left,
    };
  });

  expect(item).not.toBeNull();
  if (item === null) return;

  // A single-line task must occupy a single line. Measured against its own
  // computed line-height rather than a pixel constant, since M8's typography
  // tokens move it: without the reset the paragraph's default 1em margins
  // survive inside the flex row and the item stands three lines tall, which
  // reads as the document force-wrapping every todo. The boxes still overlap
  // vertically in that state, which is why an overlap check — the obvious
  // assertion, and the first one written here — could not see it.
  expect(item.lineHeight).toBeGreaterThan(0);
  expect(item.height, 'a one-line task must not stand taller than one line').toBeLessThan(
    item.lineHeight * 1.8,
  );
  expect(item.textLeft).toBeGreaterThan(item.boxRight);
});

test('the export menu closes on Escape and returns nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  await page.getByRole('button', { name: 'Export note' }).click();
  const menu = page.getByRole('menu', { name: 'Export as' });
  await expect(menu).toBeVisible();

  // The opener is icon-only, so a keyboard user who cannot leave the menu has no
  // way back to the note.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

// ProseMirror syncs its own model selection from a native click via a
// `selectionchange` listener, which can lag a frame or two behind the
// browser's own DOM selection change (see the investigation in this
// milestone's HeadingFold work). Settling for two animation frames after
// EVERY click before pressing the shortcut — not just the first — is what
// makes this deterministic rather than racy: the lag is a property of the
// click, not of which click in the test it happens to be.
async function settleAfterClick(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('Mod-Alt-f folds and unfolds the section under the cursor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
  // The `# ` input rule promotes this to a real heading node; `\n` starts a
  // new paragraph after it — the same pattern other specs in this file use
  // to exercise real input rules rather than a programmatic `.fill()`.
  // Leading "Title" line: a note's first block is its title and is never
  // foldable (see `headingSections`' docblock), so without it "Section one"
  // would be the title and this test's whole premise — folding the
  // ENCLOSING section — would have no section to enclose.
  await page.keyboard.type('Title\n## Section one\nbody text\n## Section two\nmore text');

  const bodyText = page.locator('.ProseMirror p', { hasText: 'body text' });
  await expect(bodyText).toBeVisible();

  // Place the caret inside the FIRST section's body paragraph — proving the
  // binding resolves the ENCLOSING section, not merely a heading the caret
  // happens to sit on.
  await bodyText.click();
  await settleAfterClick(page);

  await page.keyboard.press('ControlOrMeta+Alt+f');
  await expect(bodyText).toBeHidden();

  // The second section's own text must survive untouched — only the first
  // section folded.
  await expect(page.locator('.ProseMirror p', { hasText: 'more text' })).toBeVisible();

  // Pressing it again on the (still-collapsed) heading's own line unfolds it.
  await page.locator('h2', { hasText: 'Section one' }).click();
  await settleAfterClick(page);
  await page.keyboard.press('ControlOrMeta+Alt+f');
  await expect(bodyText).toBeVisible();
});

test('folding a heading hides its section, and the fold survives a reload', async ({ page }) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-fold',
        title: 'Title',
        // Leading title line: without it, "Alpha" is the note's title, not a
        // section, and carries no fold toggle at all (see `headingSections`'
        // docblock) — exactly the affordance this test exists to click.
        text: 'Title\n\n## Alpha\n\nhidden body\n\n## Beta\n\nkept',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });

  // Deliberately the suite's DEFAULT viewport (1280x720, `playwright.config.ts`),
  // not a widened one. A real click on the toggle at this width is exactly
  // the regression this test exists to catch: at 1280x720 the editor pane
  // lands at 656px, under the 688px-wide-pane threshold `editor.css`
  // documents, and `EditorContent`'s own `overflow-auto` used to clip most
  // of the toggle's `-3rem` box there, so a real `.click()` at its visual
  // center missed the button entirely and landed on the app shell instead.
  // `.ProseMirror`'s `max-width: min(--bear-line-width, 100% - 3rem)` fixes
  // this (see `editor.css`) by guaranteeing 1.5rem of margin on each side
  // whenever the pane is narrower than the measure PLUS 3rem (688px, not
  // 640px) — this test's own 656px pane sits inside exactly that band, which
  // is exactly the toggle's own reach — so this test must run at the width
  // where the bug lived, not one wide enough to avoid it.
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  const toggle = heading.locator('[data-fold-toggle]');

  // Quiet at rest, revealed on hover.
  await expect(toggle).toHaveCSS('opacity', '0');
  await heading.hover();
  await expect(toggle).toHaveCSS('opacity', '1');

  await toggle.click();
  await expect(page.locator('.ProseMirror p', { hasText: 'hidden body' })).toBeHidden();
  await expect(heading.locator('[data-fold-marker]')).toBeVisible();
  // The next section is untouched.
  await expect(page.locator('.ProseMirror p', { hasText: 'kept' })).toBeVisible();

  // The fold is written to `noteFolds` on the same debounced rhythm as
  // autosave (`FOLD_PERSIST_DELAY_MS`, 300ms) — reloading immediately races
  // that write, which is exactly the intermittent failure this poll first
  // surfaced (2 failures in 5 runs before this wait was added, reload
  // happening before the debounce had fired).
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const request = indexedDB.open('bear-web');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const store = db.transaction('noteFolds', 'readonly').objectStore('noteFolds');
          const row = await new Promise<{ keys: string[] } | undefined>((resolve, reject) => {
            const req = store.get('n-fold');
            req.onsuccess = () => resolve(req.result as { keys: string[] } | undefined);
            req.onerror = () => reject(req.error);
          });
          return row?.keys.length ?? 0;
        } finally {
          // A fresh connection is opened on every poll iteration, and this
          // project's own second-connection warning (see CLAUDE.md's
          // "Dexie's version(1) is IndexedDB version 10" entry) makes an
          // explicit close cheap insurance against a stray open handle
          // blocking a later version upgrade in this same page.
          db.close();
        }
      }),
    )
    .toBeGreaterThan(0);

  await page.reload();
  await page.getByRole('button', { name: /Alpha/ }).first().click();
  await expect(page.locator('.ProseMirror p', { hasText: 'hidden body' })).toBeHidden();
});

// Measured against the ProseMirror MODEL first (`headingFold.test.ts`), not
// Chromium: a caret in a `display: none` node can behave differently in a
// real browser than jsdom's DOM-only stubs would suggest, and this project
// has been caught by exactly that gap before (see CLAUDE.md's
// "jsdom drives the editor's surface too" entry). This test presses a real
// `Enter` key in real Chromium, at the exact position the unit test only
// simulates through `someProp`.
test('Enter at the end of a folded heading reveals the section instead of hiding new text in it', async ({
  page,
}) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-fold-enter',
        title: 'Title',
        // Leading title line — see the identical comment on 'n-fold' above.
        text: 'Title\n\n## Alpha\n\nhidden body\n\n## Beta\n\nkept',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  await heading.hover();
  // Fold it — the note opens unfolded, so this one click IS the fold, not an
  // unfold. Testing the Enter guard means testing it WHILE FOLDED; an extra
  // toggle here would unfold first and exercise nothing.
  await heading.locator('[data-fold-toggle]').click();

  await expect(page.locator('.ProseMirror p', { hasText: 'hidden body' })).toBeHidden();
  await expect(heading.locator('[data-fold-marker]')).toBeVisible();

  // Caret at the end of the heading's own line — the exact boundary
  // `headingFold.test.ts` targets via `contentStart - 1`. Still folded at
  // this point: nothing above has unfolded it yet.
  //
  // Three measured quirks made this harder to get right than it looks:
  //
  // 1. `<h2>` is a block element whose bounding box spans the full editor
  //    width, far past the short word "Alpha" — a plain `heading.click()`
  //    targets the CENTER of that full-width box, landing well past the
  //    text. Computing the exact coordinate of the text's own last
  //    character (via a `Range` over the heading's own direct text-node
  //    child — deliberately not `el.textContent`, which would also catch
  //    the marker widget's own "…" text and the badge's digit) is what
  //    actually lands the caret inside "Alpha".
  // 2. The immediately preceding action was a real `<button>` click (the
  //    fold toggle). Measured: the FIRST click into the contenteditable
  //    right after a real button held focus does not reliably place the
  //    caret at the click point in Chromium. An explicit `blur()` on the
  //    focused button before the positioning click avoids depending on
  //    that quirk.
  // 3. Neither a native `End` keypress nor a plain mouse click updates
  //    Tiptap's OWN `view.state.selection` synchronously — both go through
  //    ProseMirror's `DOMObserver`, which reacts to the browser's own
  //    `selectionchange` event, itself dispatched asynchronously relative
  //    to the input that caused it. Sending `Enter` immediately after
  //    positioning the caret — via `End` OR via a raw coordinate click —
  //    measurably raced that event: this guard's `handleKeyDown` still read
  //    the STALE pre-click selection when it ran, landing the split at
  //    the wrong position. A fixed sleep would only guess at how long that
  //    takes; polling the actual signal ProseMirror itself waits on —
  //    `selectionchange` firing — waits for the real condition instead of a
  //    duration, and resolves as soon as it fires rather than after a fixed
  //    interval, however comfortable.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const point = await heading.evaluate((el) => {
    let textNode: Text | null = null;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').length > 0) {
        textNode = child as Text;
      }
    }
    if (!textNode) throw new Error('heading has no direct text content');
    const length = textNode.textContent!.length;
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, length - 1));
    range.setEnd(textNode, length);
    const rect = range.getBoundingClientRect();
    return { x: rect.right - 1, y: rect.top + rect.height / 2 };
  });
  const selectionSynced = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const onChange = (): void => {
          document.removeEventListener('selectionchange', onChange);
          resolve();
        };
        document.addEventListener('selectionchange', onChange);
      }),
  );
  await page.mouse.click(point.x, point.y);
  await selectionSynced;
  await page.keyboard.press('Enter');
  await page.keyboard.type('freshly typed');

  // The fold cleared (no more persistent marker) and the previously hidden
  // body is visible again — proving Enter unfolded rather than merely
  // splitting inside a still-hidden section.
  await expect(heading.locator('[data-fold-marker]')).toHaveCount(0);
  await expect(page.locator('.ProseMirror p', { hasText: 'hidden body' })).toBeVisible();

  // The text just typed must actually be on screen, not sitting inside a
  // `display: none` node the way it did before this fix.
  await expect(page.locator('.ProseMirror p', { hasText: 'freshly typed' })).toBeVisible();
});

test('the badge menu changes a heading level, and the change reaches the Markdown', async ({
  page,
}) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-fold-level',
        title: 'Title',
        // Leading title line — see the identical comment on 'n-fold' above.
        text: 'Title\n\n## Alpha\n\nbody',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  await heading.hover();
  await heading.locator('[data-fold-badge]').click();
  await page.getByRole('menuitemradio', { name: /Heading 3/ }).click();

  await expect(page.locator('.ProseMirror h3', { hasText: 'Alpha' })).toBeVisible();

  // "Reaches the Markdown" means the SERIALIZED text changed, not merely
  // that an `<h3>` renders — an `<h3>` in the DOM proves the schema
  // attribute changed, nothing about what autosave persists. Poll IndexedDB
  // directly, the same technique the fold-persistence test above uses,
  // rather than trusting the debounced write already landed.
  await expect
    .poll(async () =>
      page.evaluate(async (id: string) => {
        const request = indexedDB.open('bear-web');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const store = db.transaction('notes', 'readonly').objectStore('notes');
          const note = await new Promise<{ text: string } | undefined>((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result as { text: string } | undefined);
            req.onerror = () => reject(req.error);
          });
          return note?.text ?? '';
        } finally {
          db.close();
        }
      }, 'n-fold-level'),
    )
    .toBe('Title\n\n### Alpha\n\nbody');
});

// This is the case a human found by eyeball testing that nothing in the
// suite caught: before `headingSections` excluded offset 0, a title `h1`
// carried the same hover-reveal fold chevron as any other heading, with
// nothing on screen to say the two behaved differently — folding it
// collapsed the ENTIRE note. `headingFold.test.ts`'s
// "renders no gutter widget for the title line" pins this at the
// ProseMirror-model level; this test pins the same thing as a human would
// actually see it, in a real browser, on hover.
test('hovering the title line reveals no fold chevron; hovering a body heading does', async ({
  page,
}) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-title-no-fold',
        title: 'Title',
        text: '# Title\n\n## Real section\n\nbody',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Title/ }).first().click();

  const titleHeading = page.locator('.ProseMirror h1', { hasText: 'Title' });
  const bodyHeading = page.locator('.ProseMirror h2', { hasText: 'Real section' });
  await expect(titleHeading).toBeVisible();
  await expect(bodyHeading).toBeVisible();

  // Hovering the title line reveals nothing — there is no chevron in the
  // DOM to reveal at all, not merely one stuck at zero opacity.
  await titleHeading.hover();
  await expect(titleHeading.locator('[data-fold-toggle]')).toHaveCount(0);

  // The same hover, on a genuine body heading, does reveal the chevron —
  // proving the title's bare DOM is the exception, not a broken selector or
  // a fold affordance that never renders for anyone.
  await bodyHeading.hover();
  const bodyToggle = bodyHeading.locator('[data-fold-toggle]');
  await expect(bodyToggle).toHaveCount(1);
  await expect(bodyToggle).toHaveCSS('opacity', '1');
});

test('the row context menu deletes the row it was opened on', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill(NOTE_TEXT);
  await editor.blur();

  const row = page.getByRole('button', { name: /Groceries/ });
  await expect(row).toBeVisible();

  // A real right-click, with a real hit test behind it — jsdom has neither,
  // so this route cannot be covered by the unit suite.
  await row.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Note actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete' }).click();

  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: /Groceries/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Trash\b/ }).click();
  await expect(page.getByRole('button', { name: /Groceries/ })).toBeVisible();
});

test('the row context menu opens from the keyboard, and PDF names its own precondition', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill(NOTE_TEXT);
  await editor.blur();

  const row = page.getByRole('button', { name: /Groceries/ });
  await row.focus();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', { name: 'Note actions' });
  await expect(menu).toBeVisible();

  // Signed out, so PDF is `aria-disabled` — which Playwright treats as "not
  // enabled" and refuses to click at all, waiting out the whole timeout. So
  // the item is driven the way `aria-disabled` exists to allow: reached by
  // keyboard, and asserted on rather than clicked. `click({ force: true })`
  // would synthesise an event no real user can produce.
  const pdf = menu.getByRole('menuitem', { name: /PDF/ });
  await expect(pdf).toHaveAttribute('aria-disabled', 'true');
  await expect(pdf).toHaveAccessibleName(/Sign in to export PDF/);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('an unpinned row reveals its pin on hover; a pinned one shows it at rest', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill(NOTE_TEXT);
  await editor.blur();

  const row = page.getByRole('button', { name: /Groceries/ });
  await expect(row).toBeVisible();
  const pin = page.getByRole('button', { name: 'Pin note' });

  // `opacity` read directly, not `toBeVisible()`, which ignores opacity
  // entirely — it would pass whether or not the reveal rule fires, since the
  // button exists and has layout either way. Same reasoning, and the same
  // trap, as the table handles' own reveal test.
  await expect(pin).toHaveCSS('opacity', '0');

  await row.hover();
  await expect(pin).toHaveCSS('opacity', '1');

  // Focus is the keyboard equivalent of that hover, and without it the pin
  // would be an invisible tab stop.
  await page.mouse.move(0, 0);
  await expect(pin).toHaveCSS('opacity', '0');
  await row.focus();
  await expect(pin).toHaveCSS('opacity', '1');

  // Once pinned it is state, not an affordance, so it stays drawn with
  // nothing hovering or focused.
  await pin.click();
  const unpin = page.getByRole('button', { name: 'Unpin note' });
  await page.mouse.move(0, 0);
  await unpin.blur();
  await expect(unpin).toHaveCSS('opacity', '1');
});
