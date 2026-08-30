import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * L2's own harness. Nothing in the unit suite can prove a real Mod-click
 * navigates a real editor to a real note — `LinkPill.ts`'s plugin logic is
 * unit-tested against a headless `Editor`, but the app-level wiring
 * (`AppShell.handleActivateLink` → `select` → `NoteEditor` remount) has no
 * coverage until this file.
 *
 * The corpus (`e2e/fixtures/corpus.ts`) carries a real link pair added for
 * this task rather than a fixture invented here, per the controller's
 * instruction to prefer reusing an existing note pair: `n-todo` ("Sprint
 * checklist") links to `n-code` ("Seeding IndexedDB before the app boots"),
 * and `n-code`'s own fenced code block additionally carries an inert
 * `[[Sprint checklist]]` for the "link inside code is inert" case.
 *
 * Note-row accessible names are `"${title}, ${date}[, ${snippet}]"`
 * (`NoteListItem.tsx`) and the link text now appears in more than one note's
 * body — `n-todo`'s snippet can contain the words "Seeding IndexedDB before
 * the app boots" as PROSE, not as its title. An unanchored `RegExp` naming
 * one note's title could therefore also match another note's row via its
 * snippet. Every row lookup below anchors with `^` for exactly this reason.
 */

const SPRINT_TITLE = 'Sprint checklist';
const SEED_TITLE = 'Seeding IndexedDB before the app boots';

/** A note-list row's accessible name is `"${title}, ${date}[, ${snippet}]"`. */
function rowNamed(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`);
}

/**
 * `BacklinksPanel.tsx` renders its rows through `SidebarRow` with the bare
 * title as the label — no date, no snippet — unlike a note-list row above.
 * An anchored prefix match still guards against one title being a substring
 * of another's, without requiring the whole (irrelevant here) suffix.
 */
function panelRowNamed(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * The editor's contenteditable, located by its stable class rather than its
 * ARIA role. `role="textbox"` flips to `role="combobox"` the instant the
 * `[[` autocomplete popover opens (`LinkAutocomplete.ts`'s editable-combobox
 * pattern) — traced via a debug run that showed the DOM node fully intact
 * with a changed role attribute while `getByRole('textbox', …)` reported
 * "element(s) not found", which reads exactly like the editor had vanished
 * until you diff the two roles. A role-based locator re-evaluates on every
 * action, so a test that types `[[` and then keeps using a `getByRole`
 * handle obtained beforehand breaks the same way.
 */
function editorLocator(page: import('@playwright/test').Page) {
  return page.locator('.ProseMirror[contenteditable="true"]');
}

test.describe('backlinks', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  });

  test('Mod-click on a link pill navigates to the target note', async ({ page }) => {
    await page.getByRole('button', { name: rowNamed(SPRINT_TITLE) }).click();
    const editor = editorLocator(page);
    await expect(editor).toContainText(SPRINT_TITLE);

    const pill = editor.locator('.bear-link', { hasText: SEED_TITLE });
    await expect(pill).toHaveAttribute('data-resolved', 'true');

    await pill.click({ modifiers: ['ControlOrMeta'] });

    // A value that changes with the behaviour, not merely "something
    // changed": the editor now contains text unique to the TARGET note's
    // body, not merely its title (which also appears, unresolved, nowhere
    // else) — proving the navigation actually landed on `n-code` rather than
    // leaving the caret in `n-todo` with the pill's own text visible.
    await expect(editor).toContainText('The seed runs in an init script');

    // The note list reflects the new selection too — this link is a
    // same-scope move (both notes are in "All notes"), so unlike the
    // cross-scope case this IS expected to show a current row.
    await expect(page.getByRole('button', { name: rowNamed(SEED_TITLE) })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('a plain click on a link pill places the caret and does not navigate', async ({ page }) => {
    await page.getByRole('button', { name: rowNamed(SPRINT_TITLE) }).click();
    const editor = editorLocator(page);

    const pill = editor.locator('.bear-link', { hasText: SEED_TITLE });
    await expect(pill).toHaveCount(1);

    // Click near the RIGHT edge of the pill, after its closing `]]`, not its
    // centre. A click landing mid-title (say, between `[[` and `Seeding`)
    // puts the caret where `linkAutocompleteMatchAt` sees an "unclosed [["
    // immediately behind it — the closing `]]` a few characters further
    // along the same line does not stop that scan — so the contenteditable
    // flips to `role="combobox"` and `getByRole('textbox', …)` stops
    // matching it at all, which read as "the editor vanished" until traced.
    // Landing past the closing brackets keeps this test about the plain
    // click's own contract, not a second, unrelated plugin.
    const box = (await pill.boundingBox())!;
    await pill.click({ position: { x: box.width - 2, y: box.height / 2 } });

    // The caret landed inside the link's range, so its decoration is
    // suppressed while the caret sits there — the same observable
    // `TagPill`'s equivalent test uses, and for the same reason: stealing
    // the click for navigation would make the text under it uneditable.
    await expect(editor.locator('.bear-link', { hasText: SEED_TITLE })).toHaveCount(0);

    // And no navigation happened: still on Sprint checklist, not the target.
    await expect(editor).toContainText(SPRINT_TITLE);
    await expect(editor).not.toContainText('The seed runs in an init script');
    await expect(page.getByRole('button', { name: rowNamed(SPRINT_TITLE) })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('the backlinks panel lists a linking note and opens it on click', async ({ page }) => {
    await page.getByRole('button', { name: rowNamed(SEED_TITLE) }).click();
    const editor = editorLocator(page);
    await expect(editor).toContainText(SEED_TITLE);

    const panel = page.getByRole('navigation', { name: 'Linked from' });
    await expect(panel).toBeVisible();
    // The exact linking note's name, not merely "a row exists" — and the
    // count badge names the real number, not just ">0".
    await expect(panel.getByRole('button', { name: panelRowNamed(SPRINT_TITLE) })).toBeVisible();
    await expect(panel.locator('[data-count]')).toHaveText('1');

    await panel.getByRole('button', { name: panelRowNamed(SPRINT_TITLE) }).click();

    await expect(editor).toContainText(SPRINT_TITLE);
    await expect(page.getByRole('button', { name: rowNamed(SPRINT_TITLE) })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('[[ autocomplete completes a real title', async ({ page }) => {
    await page.getByRole('button', { name: 'New note' }).click();
    const editor = editorLocator(page);
    await editor.click();

    await page.keyboard.type('See [[Seed');
    await expect(editor.locator('[role="option"]')).toContainText(SEED_TITLE);

    await page.keyboard.press('Enter');
    // Move the caret out of the just-inserted link's range so its
    // decoration stops being suppressed (the same suppression the plain-
    // click test above exercises from the other direction).
    await page.keyboard.type(' — done');
    await editor.blur();

    await expect(editor).toContainText(`See [[${SEED_TITLE}]] — done`);
    const pill = editor.locator('.bear-link', { hasText: SEED_TITLE });
    await expect(pill).toHaveAttribute('data-resolved', 'true');
  });

  test('a link inside a code block is inert', async ({ page }) => {
    await page.getByRole('button', { name: rowNamed(SEED_TITLE) }).click();
    const editor = editorLocator(page);
    await expect(editor.locator('pre code')).toContainText('[[Sprint checklist]]');

    // No pill was painted over it at all — the grammar itself refuses code,
    // not merely "nothing observable happens on click".
    await expect(editor.locator('.bear-link', { hasText: SPRINT_TITLE })).toHaveCount(0);

    // And a Mod-click on that literal text does not navigate: still on the
    // same note, not `n-todo`.
    await editor.locator('pre code', { hasText: 'Sprint checklist' }).click({
      modifiers: ['ControlOrMeta'],
    });
    await expect(editor).toContainText(SEED_TITLE);
    await expect(editor).not.toContainText('Rewrite the seed helper');
  });
});
