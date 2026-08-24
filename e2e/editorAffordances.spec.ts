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

/**
 * The one thing no Vitest suite can prove: that a keyboard-only user can
 * reach the code-language picker and actually choose a language with it.
 * `codeLanguageControls.test.ts` proves every individual key handler works
 * against the plugin directly; this proves the whole path is REACHABLE by a
 * real Tab sequence and a real focus model, which jsdom cannot simulate.
 */
test('a keyboard-only user can choose a code block language', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await expect(editor).toContainText('Title');
  await page.keyboard.press('Enter');
  // The backtick input rule fires on Enter with no language captured,
  // producing a bare code block — exactly the state a picker exists to fill
  // in, and the state that shows "Plain text" rather than a language name.
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');

  await expect(page.locator('.ProseMirror pre code')).toHaveCount(1);
  const trigger = page.locator('[data-code-language="trigger"]');
  await expect(trigger).toHaveText('Plain text');
  await expect(trigger).toHaveAttribute('aria-label', 'Code language: Plain text');

  // Tab forward from inside the code block until the trigger itself is
  // focused. The exact number of stops is not the claim being tested — that
  // Tab reaches it AT ALL, with no `.focus()` shortcut, is.
  let reached = false;
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    reached = await trigger.evaluate((el) => el === document.activeElement);
    if (reached) break;
  }
  expect(reached).toBe(true);

  // Open with the keyboard, never a click.
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  // From "Plain text" (the active option on open, since the block has no
  // language yet), one ArrowDown reaches "Bash" — the roster's first entry.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="option"].is-active')).toHaveText('Bash');
  await page.keyboard.press('Enter');

  // The popover closes and the DOCUMENT changed: `renderHTML`'s
  // `language-bash` class on the `<code>` element is downstream of the
  // node's `language` attribute, not of anything the widget drew itself.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ProseMirror pre code.language-bash')).toHaveCount(1);
  await expect(trigger).toHaveText('Bash');

  // Focus lands back on the writing surface, not on the trigger and not
  // lost to the page body — the same place a MOUSE pick already returns it
  // to, so the keyboard path is not a second, inconsistent contract.
  const focusedAfterChoice = await editor.evaluate((el) => el === document.activeElement);
  expect(focusedAfterChoice).toBe(true);
});

test('arrowing to the last code language option scrolls it into view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await expect(editor).toContainText('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');

  const trigger = page.locator('[data-code-language="trigger"]');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const list = page.locator('[data-code-language="list"]');
  // A single ArrowDown does not exercise the bug this test exists to catch:
  // measured in a real browser, the active option went invisible starting
  // around the 8th of thirteen rows, with `list.scrollTop` still `0` after
  // `End`. Only a jump to the LAST row proves scrolling actually happens.
  await page.keyboard.press('End');
  await expect(list.locator('[role="option"].is-active')).toHaveText('YAML');

  const active = page.locator('[role="option"].is-active');
  const activeBox = await active.boundingBox();
  const listBox = await list.boundingBox();
  expect(activeBox).not.toBeNull();
  expect(listBox).not.toBeNull();

  // The active option's box must sit WITHIN the list's own visible box —
  // not merely present in the DOM, which `toHaveText` above already
  // tolerated even when it was scrolled fully out of view.
  expect(activeBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
  expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);

  const scrollTop = await list.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
});

test('the code language list renders with no bullets and a real focus ring, and the active row reads distinct from hover', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await expect(editor).toContainText('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');

  const trigger = page.locator('[data-code-language="trigger"]');
  await trigger.click();

  const list = page.locator('[data-code-language="list"]');
  // Round 2 defect: `.ProseMirror ul { list-style: disc }` and its
  // `padding-left: 1.5em` beat a bare `.bear-code-language-list` on
  // specificity alone, rendering this widget as an indented bulleted list
  // with no error anywhere. Fixed with a MORE SPECIFIC selector
  // (`.ProseMirror .bear-code-language-list`), not an overriding utility.
  const listStyle = await list.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { listStyleType: cs.listStyleType, paddingLeft: cs.paddingLeft };
  });
  expect(listStyle.listStyleType).toBe('none');
  expect(listStyle.paddingLeft).toBe('0px');

  // Round 2 defect: the filter input's focus ring was suppressed
  // (`.bear-code-language-list:focus { outline: none }`) with no working
  // replacement. The suppression is gone; the app's ordinary
  // `:focus-visible` ring must paint on the input that actually holds focus
  // while the popover is open.
  const filterInput = page.locator('[data-code-language="filter"]');
  await expect(filterInput).toBeFocused();
  const outline = await filterInput.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');

  // Round 2 defect: `.is-active`'s background resolved identical to
  // `:hover`'s, so a hovered row and the keyboard-active row were visually
  // indistinguishable. Hover a DIFFERENT row than the active one and assert
  // their backgrounds differ, with the active row carrying its own ring.
  await page.locator('[data-code-language-option="css"]').hover();
  const [activeBackground, activeShadow, hoveredBackground] = await Promise.all([
    page
      .locator('[role="option"].is-active')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    page.locator('[role="option"].is-active').evaluate((el) => getComputedStyle(el).boxShadow),
    page
      .locator('[data-code-language-option="css"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(activeShadow).not.toBe('none');
  expect(activeBackground).not.toBe(hoveredBackground);
});

test('Escape closes the code language popover and returns focus to the trigger', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await expect(editor).toContainText('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');

  const trigger = page.locator('[data-code-language="trigger"]');
  let reached = false;
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    reached = await trigger.evaluate((el) => el === document.activeElement);
    if (reached) break;
  }
  expect(reached).toBe(true);

  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const focusedAfterEscape = await trigger.evaluate((el) => el === document.activeElement);
  expect(focusedAfterEscape).toBe(true);
});
