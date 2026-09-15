import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

/**
 * Sub-project U's own harness.
 *
 * Nothing in the unit suite can prove any of this. Following a link crosses
 * `AppShell` → `select` → a keyed `NoteEditor` remount → an effect in
 * `RichEditor`, and the thing it does at the end is SCROLL — which jsdom
 * cannot do at all (it implements no `scrollIntoView`, and `RichEditor`
 * guards on exactly that).
 *
 * Notes are seeded here rather than added to `e2e/fixtures/corpus.ts`: that
 * corpus is shared with `measure` and `shots`, and an extra note in it moves
 * note-list geometry into `docs/design/measurements.md`'s committed diff. Same
 * reasoning `backlinks.spec.ts` records for its own typed fixture.
 */

const FIXED_NOW = Date.UTC(2026, 8, 15, 6, 0, 0);

const SOURCE = 'Release notes';
const TARGET = 'Deploy Checklist';

/** Long enough that `Rollback` starts below the fold, so a scroll is needed. */
const TARGET_TEXT = [
  `# ${TARGET}`,
  '',
  '## Preflight',
  '',
  ...Array.from({ length: 40 }, (_, i) => `Preflight line ${i + 1}.`),
  '',
  '## Rollback',
  '',
  'Revert the deploy, then drain the queue.',
  '',
  '## Smoke tests',
  '',
  'Run the suite twice.',
].join('\n');

const SOURCE_TEXT = `# ${SOURCE}\n\nSee [[${TARGET}/Rollback]] before shipping.`;

/** A note-list row's accessible name is `"${title}, ${date}[, ${snippet}]"`. */
function rowNamed(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`);
}

function editorLocator(page: import('@playwright/test').Page) {
  return page.locator('.ProseMirror[contenteditable="true"]');
}

async function seed(page: import('@playwright/test').Page, sourceText = SOURCE_TEXT) {
  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-src',
        title: SOURCE,
        text: sourceText,
        createdAt: FIXED_NOW - 1000,
        updatedAt: FIXED_NOW - 500,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
      {
        id: 'n-target',
        title: TARGET,
        text: TARGET_TEXT,
        createdAt: FIXED_NOW - 2000,
        updatedAt: FIXED_NOW - 1500,
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
}

test.describe('heading links', () => {
  test('a heading link opens the target note scrolled to that heading', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);

    // Waited for, not assumed: the known-title set reaches the plugin from an
    // effect after `notes.allNoteTitles()` resolves, so the pill is briefly
    // unresolved — and clicking it then places a caret instead of navigating.
    const pill = editor.locator('.bear-link', { hasText: TARGET }).first();
    await expect(pill).toHaveAttribute('data-resolved', 'true');
    await pill.click();

    // Text unique to the TARGET's body, so this cannot pass on the source
    // note merely rendering the link's own text.
    await expect(editor).toContainText('Revert the deploy');
    // `toBeInViewport`, not `toBeVisible`: the latter is true for anything
    // rendered, including a heading 2000px below the fold, so it could not
    // tell a scroll that happened from one that did not.
    await expect(page.getByRole('heading', { name: 'Rollback' })).toBeInViewport();
    // And the note it did NOT scroll past: `Smoke tests` sits after the
    // target, so a scroll that ran to the bottom instead would also satisfy
    // the assertion above.
    await expect(page.getByRole('heading', { name: 'Preflight' })).not.toBeInViewport();
  });

  test('a heading link inside the current note scrolls without changing notes', async ({
    page,
  }) => {
    // The case the nonce exists for: nothing remounts, so a read-once-at-mount
    // prop would do nothing at all here.
    // Its own title, and its own copy of the long body, so the link points
    // INTO the note it already lives in.
    await seed(
      page,
      `# ${SOURCE}\n\nJump to [[${SOURCE}/Rollback]] from here.\n\n${TARGET_TEXT.split('\n')
        .slice(1)
        .join('\n')}`,
    );
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);
    await expect(editor).toContainText('Jump to');

    const current = page.locator('[aria-current="true"]').first();
    const before = await current.textContent();

    const selfPill = editor.locator('.bear-link', { hasText: SOURCE }).first();
    await expect(selfPill).toHaveAttribute('data-resolved', 'true');
    const rollback = page.getByRole('heading', { name: 'Rollback' });

    await selfPill.click();
    await expect(rollback).toBeInViewport();
    // Still the same note: no navigation happened, only a scroll.
    await expect(page.locator('[aria-current="true"]').first()).toHaveText(before ?? '');

    /*
     * The SECOND follow is the whole test, and the first one alone is not.
     *
     * Written with a single click, this test passed against an effect keyed
     * on the heading TEXT instead of the nonce — because the first follow
     * changes that text from undefined and runs either way. Only a repeat
     * follow, where nothing but the nonce differs, can tell the two apart.
     * Demonstrated: keying the effect on `revealHeading?.text` fails here and
     * nowhere else in the suite.
     */
    await editor.hover();
    await page.mouse.wheel(0, -10000);
    await expect(rollback).not.toBeInViewport();

    await selfPill.click();

    await expect(rollback).toBeInViewport();
  });

  test('a link to a folded section unfolds it', async ({ page }) => {
    await seed(page);

    // Fold `Rollback` in the target note first, by its gutter control.
    await page.getByRole('button', { name: rowNamed(TARGET) }).click();
    const editor = editorLocator(page);
    /*
     * VISIBILITY, not text. A folded section is hidden with `display: none`
     * (`editor.css`'s `.bear-fold-hidden`) and its text stays in the DOM, so
     * `toContainText` — which reads `textContent` — is true whether the
     * section is folded or not. Written that way first, this test passed
     * against a fold that never happened AND would have passed against an
     * unfold that never happened: two vacuous assertions in one test.
     */
    const body = editor.getByText('Revert the deploy, then drain the queue.');
    await expect(body).toBeVisible();

    const rollback = page.getByRole('heading', { name: 'Rollback' });
    await rollback.hover();
    // `[data-fold-toggle]`, the way `appearance.spec.ts` locates it: the
    // control is a ProseMirror widget inside the heading, and its accessible
    // name is the badge's text rather than its own label.
    await rollback.locator('[data-fold-toggle]').click();
    await expect(body).toBeHidden();

    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const foldedPill = editor.locator('.bear-link', { hasText: TARGET }).first();
    await expect(foldedPill).toHaveAttribute('data-resolved', 'true');
    await foldedPill.click();

    // The BODY is visible again, not merely a changed fold attribute:
    // arriving at a collapsed heading with nothing under it is exactly the
    // failure this asserts against.
    await expect(editor.getByText('Revert the deploy, then drain the queue.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rollback' })).toBeInViewport();
  });

  test('a link whose heading no longer exists still opens the note', async ({ page }) => {
    await seed(page, `# ${SOURCE}\n\nSee [[${TARGET}/Gone for good]] before shipping.`);
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);

    // It resolves: the NOTE is what decides, never the heading.
    const pill = editor.locator('.bear-link', { hasText: TARGET }).first();
    await expect(pill).toHaveAttribute('data-resolved', 'true');

    await pill.click();

    await expect(editor).toContainText('Revert the deploy');
    await expect(page.getByRole('button', { name: rowNamed(TARGET) })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('the popover offers the target note headings after a slash', async ({ page }) => {
    await seed(page, `# ${SOURCE}\n\nbody`);
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(` [[${TARGET}/`);

    const options = page.locator('.bear-link-autocomplete-list [role="option"]');
    await expect(options).toHaveText(['Preflight', 'Rollback', 'Smoke tests']);

    await page.keyboard.type('smo');
    await expect(options).toHaveText(['Smoke tests']);
    await page.keyboard.press('Enter');

    // Both halves come from storage, not from what was typed.
    await expect(editor).toContainText(`[[${TARGET}/Smoke tests]]`);
  });

  /**
   * The gap U shipped with, reported from production on 2026-09-15.
   *
   * The popover inserts `[[Title]]` CLOSED, so the only way to add a heading
   * to a link it just wrote is to move back inside — and L2's closing-link
   * guard refused exactly that position. The two halves of the feature could
   * not be used together, which no test in the branch noticed because every
   * one of them typed the title by hand and never let the popover close it.
   */
  test('a heading can be added to a link the popover already closed', async ({ page }) => {
    await seed(page, `# ${SOURCE}\n\nbody`);
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' [[Deploy');
    const options = page.locator('.bear-link-autocomplete-list [role="option"]');
    await expect(options).toHaveText([TARGET]);
    await page.keyboard.press('Enter');
    await expect(editor).toContainText(`[[${TARGET}]]`);

    // Back inside the closed link, exactly where a reader would click.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('/');

    await expect(options).toHaveText(['Preflight', 'Rollback', 'Smoke tests']);
    await page.keyboard.type('roll');
    await page.keyboard.press('Enter');

    // ONE pair of brackets. The guard existed because replacing through the
    // caret alone stranded the original `]]`, so this is the assertion that
    // matters: `closeTo` consumed them.
    await expect(editor).toContainText(`[[${TARGET}/Rollback]]`);
    await expect(editor).not.toContainText(']]]');
  });

  test('a note whose own title contains a slash is not read as a heading link', async ({
    page,
  }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, {
      notes: [
        {
          id: 'n-src',
          title: SOURCE,
          text: `# ${SOURCE}\n\nSee [[A/B testing]] here.`,
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 500,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
        },
        {
          id: 'n-ab',
          title: 'A/B testing',
          text: '# A/B testing\n\nThe variant split.',
          createdAt: FIXED_NOW - 2000,
          updatedAt: FIXED_NOW - 1500,
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
    await page.getByRole('button', { name: rowNamed(SOURCE) }).click();
    const editor = editorLocator(page);

    const pill = editor.locator('.bear-link', { hasText: 'A/B testing' }).first();
    await expect(pill).toHaveAttribute('data-resolved', 'true');
    // No separator span: the slash belongs to the title, so it is not dimmed
    // and the link is not split.
    await expect(editor.locator('.bear-link__slash')).toHaveCount(0);

    await pill.click();

    await expect(editor).toContainText('The variant split');
  });
});
