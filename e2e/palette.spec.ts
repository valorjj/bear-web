import { expect, test, type Page } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * L4's own harness. Nothing in the unit suite can prove `⌘K` actually opens
 * a real modal over the real shell, that `aria-activedescendant` genuinely
 * tracks the arrow keys rather than merely existing, or that a destructive
 * command truly waits for `ConfirmDialog` rather than running inline — the
 * component tests exercise `CommandPalette` and `buildCommands` in isolation
 * (`src/features/palette/*.test.ts(x)`), never the wiring in `AppShell` that
 * connects the shortcut, the lazy chunk and the confirm-dialog routing.
 *
 * The corpus (`e2e/fixtures/corpus.ts`) seeds 11 live notes (13 total, 2
 * trashed — `allNoteIndex` excludes trash, matching what the palette's own
 * note search reads) and 0 commands begin matched against an empty query, by
 * design (`CommandPalette.tsx`'s `rows` memo returns `matchedNotes = []`
 * whenever the trimmed query is empty).
 */

const combobox = (page: Page) => page.getByRole('combobox', { name: 'Command palette' });
const listbox = (page: Page) => page.getByRole('listbox', { name: 'Command palette' });
const noteRows = (page: Page) =>
  page.getByRole('region', { name: 'Note list' }).getByRole('listitem');

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Meta+K');
}

test.describe('command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  });

  test('Meta+K opens the palette and focuses the combobox', async ({ page }) => {
    await openPalette(page);

    await expect(combobox(page)).toBeVisible();
    await expect(combobox(page)).toBeFocused();
  });

  test('an empty query lists commands and ZERO note options', async ({ page }) => {
    await openPalette(page);
    await expect(combobox(page)).toBeVisible();

    // Assert a COUNT, not the absence of one particular name: a palette that
    // regressed to listing every note would still fail to contain any single
    // note's title we happened to check for, which would prove nothing.
    const options = listbox(page).getByRole('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    const noteOptions = options.filter({ hasText: 'Bookshelf' });
    await expect(noteOptions).toHaveCount(0);

    // Every option present is a command, never a note: the note group header
    // ('Notes') must not appear at all while the query is empty.
    await expect(listbox(page).locator('[data-palette-header]', { hasText: 'Notes' })).toHaveCount(
      0,
    );
  });

  test('typing a corpus note title surfaces it, and Enter opens it', async ({ page }) => {
    await openPalette(page);
    await combobox(page).fill('Bookshelf');

    const option = listbox(page).getByRole('option', { name: 'Bookshelf' });
    await expect(option).toBeVisible();

    await combobox(page).press('Enter');

    await expect(combobox(page)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText('Bookshelf');
  });

  test('ArrowDown changes aria-activedescendant to a new value', async ({ page }) => {
    await openPalette(page);

    const before = await combobox(page).getAttribute('aria-activedescendant');
    expect(before).not.toBeNull();

    await combobox(page).press('ArrowDown');

    const after = await combobox(page).getAttribute('aria-activedescendant');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  test('Escape closes the palette', async ({ page }) => {
    await openPalette(page);
    await expect(combobox(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(combobox(page)).toHaveCount(0);
  });

  test('Empty trash opens the confirm dialog and trashes nothing until confirmed', async ({
    page,
  }) => {
    // Switch to the Trash smart list first: the corpus seeds 2 trashed notes
    // (`n-trash-1`, `n-trash-2`), which is the count that actually moves when
    // "Empty trash" runs. The default (non-trash) note list would stay at the
    // same count before AND after a real empty-trash, which would prove
    // nothing about confirmation gating either way.
    await page
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('button', { name: /^Trash\b/ })
      .click();
    await expect(noteRows(page)).toHaveCount(2);

    await openPalette(page);
    await combobox(page).fill('Empty trash');
    await page.getByRole('option', { name: 'Empty trash' }).click();

    // The palette closes and hands off to AppShell's own ConfirmDialog.
    await expect(combobox(page)).toHaveCount(0);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // Unchanged while confirmation is pending: nothing runs until Confirm.
    await expect(noteRows(page)).toHaveCount(2);

    await dialog.getByRole('button', { name: 'Empty trash' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(noteRows(page)).toHaveCount(0);
  });
});
