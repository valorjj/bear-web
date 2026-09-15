import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

/**
 * Sub-project V's own harness.
 *
 * The unit suite drives the plugin directly; what only a browser can show is
 * that the toolbar control produces a usable footnote, that the two jumps
 * land, and that collapsing genuinely hides the notes rather than merely
 * changing an attribute.
 *
 * Notes are seeded here rather than added to `e2e/fixtures/corpus.ts`, which
 * is shared with `measure` and `shots`: an extra note there moves note-list
 * geometry into `docs/design/measurements.md`'s committed diff.
 */

const FIXED_NOW = Date.UTC(2026, 8, 15, 6, 0, 0);

const TITLE = 'Footnotes';
const TEXT = [
  `# ${TITLE}`,
  '',
  'Bear uses CommonMark[^why] for this.',
  '',
  ...Array.from({ length: 30 }, (_, i) => `Filler line ${i + 1}.`),
  '',
  '[^why]: The formalised superset of Markdown.',
].join('\n');

function rowNamed(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`);
}

async function seed(page: import('@playwright/test').Page, text = TEXT) {
  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-foot',
        title: TITLE,
        text,
        createdAt: FIXED_NOW - 1000,
        updatedAt: FIXED_NOW - 500,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [
      { key: 'pane.sidebarWidth', value: 240 },
      { key: 'pane.noteListWidth', value: 320 },
    ],
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  await page.getByRole('button', { name: rowNamed(TITLE) }).click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  // The TITLE, which every fixture here shares — not text from the default
  // one, which is what this waited on first and which made two tests fail on
  // the readiness check rather than on what they assert.
  await expect(editor).toContainText(TITLE);
  return editor;
}

test.describe('footnotes', () => {
  /**
   * Driven through the REAL control, not by typing the Markdown it would
   * produce. Sub-project U shipped a feature unreachable by its own flow
   * because every test hand-typed the popover's output; see
   * `docs/rulings/tag-pills.md`.
   */
  test('the toolbar control inserts a footnote and puts the caret in it', async ({ page }) => {
    const editor = await seed(page, `# ${TITLE}\n\nJust a sentence.`);

    await editor.getByText('Just a sentence.').click();
    await page.keyboard.press('End');
    // `exact`, because the 각주 section's own header button is named
    // "Footnotes" and a substring match claims both.
    await page.getByRole('button', { name: 'Footnote', exact: true }).click();

    // The caret is in the new footnote, so typing lands there.
    await page.keyboard.type('Typed straight in.');

    await expect(editor).toContainText('Typed straight in.');
    // And the marker took a number, which only happens if both halves exist.
    await expect(page.locator('.bear-footnote-number').first()).toHaveText('1');
  });

  test('clicking a marker lands on its footnote', async ({ page }) => {
    const editor = await seed(page);
    const definition = editor.getByText('The formalised superset');
    await expect(definition).not.toBeInViewport();

    await page.locator('.bear-footnote-number').first().click();

    await expect(definition).toBeInViewport();
  });

  test('the back link returns to the reference', async ({ page }) => {
    const editor = await seed(page);
    await page.locator('.bear-footnote-number').first().click();
    await expect(editor.getByText('The formalised superset')).toBeInViewport();

    await page.locator('[data-footnote-back]').click();

    await expect(editor.getByText('Bear uses CommonMark')).toBeInViewport();
  });

  test('collapsing the section hides the footnote bodies', async ({ page }) => {
    const editor = await seed(page);
    // VISIBILITY, not text: a collapsed section keeps its text in the DOM
    // under `display: none`, so `toContainText` is true either way — the
    // vacuous assertion sub-project U shipped and had to rewrite.
    const body = editor.getByText('The formalised superset');
    await expect(body).toBeVisible();

    await page.locator('[data-footnote-section-toggle]').click();

    await expect(body).toBeHidden();
  });

  test('inserting a footnote above another renumbers without editing the text', async ({
    page,
  }) => {
    const editor = await seed(page, `# ${TITLE}\n\nAlpha and beta[^why].\n\n[^why]: Because.`);
    await expect(page.locator('.bear-footnote-number').first()).toHaveText('1');

    // Insert one BEFORE the existing marker.
    await editor.getByText('Alpha and beta').click();
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Footnote', exact: true }).click();

    // The new one is 1 and the original is 2 — and `why` is still labelled
    // `why`. Asserted through the DOM attribute, not the editor's text: the
    // rendered note shows "2. Because.", never the raw `[^why]:` syntax, so a
    // text assertion here was checking for something no reader ever sees.
    await expect(page.locator('.bear-footnote-number')).toHaveText(['1', '2']);
    await expect(editor.locator('[data-footnote-def="why"]')).toHaveCount(1);
  });
});
