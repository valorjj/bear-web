import { expect, test } from '@playwright/test';

/**
 * The three editor affordances added in E, covering only what no unit test
 * can: real geometry, and Chromium's real focus behaviour.
 *
 * Everything about WHAT these controls do — the commands, the Markdown they
 * produce, the decoration set — is asserted in Vitest
 * (`tableControls.test.ts`, `toolbars.test.tsx`, `headingFold.test.ts`).
 * jsdom has no layout engine, so where the bar lands and whether a button in
 * a ProseMirror widget can take focus are only answerable here.
 */

async function openNoteWithTable(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // Typed, never filled: the table comes from the toolbar, but the title line
  // above it has to exist first or the table is the note's first block.
  await page.keyboard.type('Title');
  // Each step asserts its own result before the next begins. Under
  // full-suite contention these actions can still be in flight when the next
  // one runs, and the resulting failure surfaces several steps later as
  // "the table bar never appeared" — which reads as a product bug.
  await expect(editor).toContainText('Title');

  await page.keyboard.press('Enter');
  await page
    .getByRole('toolbar', { name: 'Formatting toolbar' })
    .getByRole('button', { name: 'Table' })
    .click();

  await expect(page.locator('.ProseMirror table')).toHaveCount(1);
}

test('the table bar sits above the table it belongs to', async ({ page }) => {
  await openNoteWithTable(page);

  const bar = page.getByRole('toolbar', { name: 'Table' });
  await expect(bar).toBeVisible();

  const barBox = await bar.boundingBox();
  const tableBox = await page.locator('.ProseMirror table').boundingBox();
  expect(barBox).not.toBeNull();
  expect(tableBox).not.toBeNull();

  // Above, not overlapping. The widget is placed INSIDE the scrolling content
  // precisely so this holds without any geometry code — a regression to
  // `fixed` positioning would show up here as drift.
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(tableBox!.y);
  // Left-aligned with the table, and never wider than it.
  expect(Math.abs(barBox!.x - tableBox!.x)).toBeLessThan(2);
});

test('the bar goes away when the caret leaves the table', async ({ page }) => {
  await openNoteWithTable(page);
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();

  // The title paragraph, which is outside the table. `.first()` is the note
  // title rather than a cell's paragraph — cells contain paragraphs too, and
  // clicking one of those would leave the caret inside the table and the bar
  // correctly visible.
  const title = page.locator('.ProseMirror > p').first();
  await expect(title).toContainText('Title');
  await title.click();

  // Asserts the CARET actually left before asserting the consequence. Without
  // this, a click that did not take reads as "the bar refuses to hide", which
  // points at the plugin rather than at the click. Observed roughly once in
  // nine full runs under contention.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode ?? null;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest('table') === null || element?.closest('table') === undefined;
      }),
    )
    .toBe(true);

  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeHidden();
});

/**
 * `docs/rulings/accessibility.md` records that Chromium refuses `.focus()` to
 * every descendant of a HEADING containing a `Decoration.widget` — measured
 * across seven experiments, and the reason B1's fold gutter is mouse-only
 * with `Mod-Alt-F` as its keyboard route.
 *
 * That finding does NOT extend here, and this test is what keeps the claim
 * honest rather than assumed: a button in the table bar's widget takes focus
 * normally, so the bar needs no keyboard escape hatch of its own. If Chromium
 * ever generalises the heading behaviour, this fails and the bar needs the
 * same treatment the fold gutter got.
 */
test('a table bar button can take focus, unlike the fold gutter', async ({ page }) => {
  await openNoteWithTable(page);
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();

  const focused = await page.evaluate(() => {
    const button = document.querySelector('[data-table-action]') as HTMLElement | null;
    button?.focus();
    return document.activeElement === button;
  });

  expect(focused).toBe(true);
});

test('the heading gutter draws its level as a glyph, not a digit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');
  // Typed, never filled: `## ` is an input rule and `fill` bypasses input
  // rules entirely.
  await page.keyboard.type('## Section');

  const badge = page.locator('[data-fold-badge]').first();
  await expect(badge).toHaveAttribute('data-level', '2');
  await expect(badge.locator('svg')).toHaveCount(1);
  expect(await badge.textContent()).toBe('');
});

test('a highlight colour chosen from the menu survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('highlight me');
  await expect(editor).toContainText('highlight me');

  /*
   * Triple-click selects the paragraph outright, rather than steering the
   * caret with Shift+ArrowLeft from wherever it happens to be.
   *
   * Two earlier attempts failed intermittently for two different reasons:
   * Shift+Home walked to the start of the DOCUMENT and swept up the title
   * line, and Shift+ArrowLeft produced an EMPTY selection whenever the editor
   * had lost focus between typing and the keypress — this component is keyed
   * and remounts when a seeded note first acquires an id. A pointer selection
   * depends on neither the caret's history nor on focus surviving.
   *
   * The selection is then asserted before the menu opens, because a mark
   * command against a collapsed selection sets stored marks rather than
   * marking anything, and the resulting failure looks like "colours are
   * broken" several steps later.
   */
  const paragraph = page.locator('.ProseMirror > p').last();
  await paragraph.click({ clickCount: 3 });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('highlight me');

  await page.getByRole('button', { name: 'Highlight colour' }).click();
  await page.getByRole('menuitemradio', { name: 'Green' }).click();

  const mark = page.locator('.ProseMirror mark.hl-green');
  await expect(mark).toHaveText('highlight me');

  // The colour is note DATA, not view state: it has to come back through
  // IndexedDB and the Markdown round-trip, not just through React.
  await editor.blur();

  // Waits on the WRITE, not on a timeout: this asserts the coloured Markdown
  // actually reached IndexedDB before the reload. Blurring only schedules the
  // flush, and reloading into that race is what made this test flaky under
  // load.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('bear-web');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return await new Promise<string>((resolve) => {
          const all = database.transaction('notes').objectStore('notes').getAll();
          all.onsuccess = () => resolve(all.result.map((note) => note.text).join('\n'));
        });
      }),
    )
    .toContain('<mark class="hl-green">highlight me</mark>');

  await page.reload();
  // Nothing is selected on a cold boot, so the note has to be reopened from
  // the list — which is also the stronger assertion: the colour is coming
  // back out of IndexedDB and through `parseMarkdown`, not out of React.
  await page.getByRole('button', { name: /Title/ }).first().click();
  await expect(page.locator('.ProseMirror mark.hl-green')).toHaveText('highlight me');
});
