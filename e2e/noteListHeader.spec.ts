import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { SeedNote } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The note-list header: its menu, the two durable preferences it writes, and
 * the scope shortcuts.
 *
 * Timestamps are pinned rather than taken from the clock. `compareNotes` falls
 * back to an id tiebreaker when the primary field ties, so two notes sharing a
 * millisecond would make the DEFAULT order nondeterministic — which made the
 * equivalent unit test flaky before its fixture was pinned too.
 */
function note(overrides: Partial<SeedNote> & Pick<SeedNote, 'id' | 'title' | 'text'>): SeedNote {
  return {
    createdAt: 1_000,
    updatedAt: 1_000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const APPLE = note({
  id: 'apple',
  title: 'Apple',
  text: 'Apple\nred and round',
  createdAt: 3_000,
  updatedAt: 1_000,
});

const BANANA = note({
  id: 'banana',
  title: 'Banana',
  text: 'Banana\nyellow and long',
  createdAt: 1_000,
  updatedAt: 2_000,
});

/** Titles of the note rows, in render order. Scoped to the note-list pane: the
 *  sidebar's smart lists and tag tree are `<li>` rows too. */
async function noteTitles(page: Page): Promise<string[]> {
  const rows = page.getByRole('region', { name: 'Note list' }).getByRole('listitem');
  return (await rows.allTextContents()).map((text) => text.trim());
}

/**
 * Waits until a preference has actually reached IndexedDB.
 *
 * The DOM cannot be used for this. `useSetting` holds an optimistic value so a
 * menu choice renders immediately, and `settings.set` is fire-and-forget — so
 * the list reads as "committed" a moment before the write has landed, and a
 * `page.reload()` fired in that window reloads a database that never received
 * it. A human cannot click and reload inside that gap; Playwright does it every
 * time.
 *
 * `smoke.spec.ts` reads IndexedDB directly for exactly this reason, against
 * `usePaneWidths`' equivalent optimistic override. Same problem, same route.
 */
async function waitForSetting(page: Page, key: string, expected: unknown): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (k) =>
            new Promise<unknown>((resolve) => {
              const request = indexedDB.open('bear-web');
              request.onerror = () => resolve(undefined);
              request.onsuccess = () => {
                const database = request.result;
                const get = database.transaction('settings').objectStore('settings').get(k);
                get.onsuccess = () => {
                  resolve((get.result as { value?: unknown } | undefined)?.value);
                  database.close();
                };
                get.onerror = () => {
                  resolve(undefined);
                  database.close();
                };
              };
            }),
          key,
        ),
      { message: `waiting for the ${key} setting to reach IndexedDB` },
    )
    .toEqual(expected);
}

async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^List options/ }).click();
  await expect(page.getByRole('menu', { name: 'List options' })).toBeVisible();
}

test.describe('note list header', () => {
  test('names the current scope', async ({ page }) => {
    await seedDatabase(page, { notes: [APPLE], settings: [] });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'List options: Notes' })).toBeVisible();
  });

  test('a chosen sort survives a reload', async ({ page }) => {
    await seedDatabase(page, { notes: [APPLE, BANANA], settings: [] });
    await page.goto('/');

    // The default: newest first by modification, so Banana leads.
    await expect
      .poll(() => noteTitles(page))
      .toEqual([expect.stringContaining('Banana'), expect.stringContaining('Apple')]);

    await openMenu(page);
    await page.getByRole('menuitemradio', { name: 'Title' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Newest first' }).click();
    await page.keyboard.press('Escape');

    await expect
      .poll(() => noteTitles(page))
      .toEqual([expect.stringContaining('Apple'), expect.stringContaining('Banana')]);

    await page.reload();

    await expect
      .poll(() => noteTitles(page))
      .toEqual([expect.stringContaining('Apple'), expect.stringContaining('Banana')]);
  });

  test('a chosen preview density survives a reload', async ({ page }) => {
    await seedDatabase(page, { notes: [APPLE], settings: [] });
    await page.goto('/');

    await expect(page.getByText('red and round')).toBeVisible();

    await openMenu(page);
    await page.getByRole('menuitemradio', { name: 'Small' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByText('red and round')).toHaveCount(0);

    await waitForSetting(page, 'previewSize', 'small');
    await page.reload();

    await expect(page.getByRole('button', { name: /Apple/ })).toBeVisible();
    await expect(page.getByText('red and round')).toHaveCount(0);
  });

  test('the sort group is disabled in Trash, with the reason on screen', async ({ page }) => {
    await seedDatabase(page, {
      notes: [note({ id: 'gone', title: 'Gone', text: 'Gone', trashedAt: 5_000 })],
      settings: [],
    });
    await page.goto('/');
    // Wait for the app to be up before pressing: a key sent at document_start
    // reaches no listener, and the failure looks like a broken shortcut.
    await expect(page.getByRole('button', { name: 'List options: Notes' })).toBeVisible();

    await page.keyboard.press('Meta+Shift+Digit0');
    await expect(page.getByRole('button', { name: 'List options: Trash' })).toBeVisible();

    await openMenu(page);

    await expect(page.getByRole('menuitemradio', { name: 'Title' })).toBeDisabled();
    await expect(page.getByText('Trash is ordered by when notes were deleted.')).toBeVisible();
  });

  test('⇧⌘3 switches to Todo from a cold page', async ({ page }) => {
    await seedDatabase(page, {
      notes: [note({ id: 'chores', title: 'Chores', text: 'Chores\n- [ ] sweep' })],
      settings: [],
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'List options: Notes' })).toBeVisible();

    await page.keyboard.press('Meta+Shift+Digit3');

    await expect(page.getByRole('button', { name: 'List options: Todo' })).toBeVisible();
  });

  test('⇧⌘4 switches scope with the editor focused, and writes no heading', async ({ page }) => {
    // The regression test for the ⌥⌘ collision. Heading levels are bound to
    // `Mod-Alt-${level}` by @tiptap/extension-heading, so a scope shortcut in
    // the ⌥⌘ family would BOTH switch scope and turn the current line into an
    // H1. Only a real browser can run this: jsdom has no ProseMirror keymap
    // dispatch driven by real key events.
    await seedDatabase(page, {
      notes: [note({ id: 'draft', title: 'Draft', text: 'Draft\n\nsome body text' })],
      settings: [],
    });
    await page.goto('/');

    await page.getByRole('button', { name: /Draft/ }).click();
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await expect(editor).toBeFocused();

    const headingsBefore = await editor.locator('h1, h2, h3, h4, h5, h6').count();

    await page.keyboard.press('Meta+Shift+Digit4');

    await expect(page.getByRole('button', { name: 'List options: Today' })).toBeVisible();
    await expect(editor.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(headingsBefore);
  });

  test("⌥⌘4 is the editor's, and is why the scope shortcuts are ⇧⌘", async ({ page }) => {
    // The other half of the ruling, as executable evidence rather than a
    // comment: the ⌥⌘ digit family belongs to @tiptap/extension-heading. If
    // this ever stops making a heading, the reason ⇧⌘ was chosen has gone
    // away and the ruling should be revisited — and if scope ALSO changed
    // here, one keystroke would be doing two unrelated things.
    //
    // The press is `ControlOrMeta+Alt`, not `Alt+Meta`. Tiptap binds headings
    // to `Mod-Alt-<level>`, and ProseMirror resolves `Mod-` to Cmd on macOS
    // but Ctrl everywhere else — so a hardcoded Meta press makes the heading
    // on a developer's Mac and silently makes nothing on a Linux CI runner,
    // where Meta is Super. The app's own scope shortcuts accept
    // `metaKey || ctrlKey` (useScopeShortcuts.ts) and are unaffected, which is
    // why this was the only test to fail there. Every other spec in this
    // directory already presses `ControlOrMeta`; this one did not.
    await seedDatabase(page, {
      notes: [note({ id: 'draft', title: 'Draft', text: 'Draft\n\nsome body text' })],
      settings: [],
    });
    await page.goto('/');

    await page.getByRole('button', { name: /Draft/ }).click();
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await expect(editor).toBeFocused();

    // Put the caret in the body paragraph, not the title line — and inside the
    // editor, since the note-list row shows the same text as its snippet.
    await editor.getByText('some body text').click();

    await page.keyboard.press('ControlOrMeta+Alt+Digit4');

    await expect(editor.locator('h4')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'List options: Notes' })).toBeVisible();
  });
});
