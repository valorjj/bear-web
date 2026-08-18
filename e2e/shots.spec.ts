import { expect, test, type Locator, type Page } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The design screenshot harness. Not a test — it asserts almost nothing, and it
 * is excluded from `npm run test:e2e` by `grepInvert` in `playwright.config.ts`
 * so it neither slows the suite nor inflates its count. Run it with
 * `npm run shots`.
 *
 * It exists because nothing else in this project can see "renders wrong": the
 * unit suite has no layout engine, and `e2e/appearance.spec.ts` is deliberately
 * relative. UI work here is therefore a change-shoot-compare loop, and this is
 * the shoot step: one fixed set of framings, both themes, against the fixed
 * corpus, written to `docs/design/shots/`.
 *
 * Everything that could drift between two runs is pinned — the clock, the
 * timezone, the locale, the viewport, the pane widths (in the corpus), and the
 * focused element. Motion is frozen per-screenshot with `animations: 'disabled'`
 * rather than by forcing `prefers-reduced-motion`, which would zero the duration
 * tokens and so review a configuration the app does not ship by default. A shot that differs between runs must differ because
 * the app changed.
 */

const SHOTS = 'docs/design/shots';

const THEMES = [
  { name: 'paper', colorScheme: 'light' as const },
  { name: 'ink', colorScheme: 'dark' as const },
];

/**
 * Waits until every asynchronous thing that changes the picture has landed: the
 * note list's live query, the tag index rebuild that `seedDatabase` deliberately
 * leaves to the app, and the web fonts. Without the font wait the first shot of
 * a run renders in `system-ui` and the rest in Pretendard.
 */
async function settle(page: Page, { seeded = true } = {}): Promise<void> {
  const list = page.getByRole('region', { name: 'Note list' });
  await expect(list).toBeVisible();

  if (seeded) {
    await expect(page.getByRole('button', { name: /US market daily/ })).toBeVisible();
    // The tag tree is populated by the app's own startup rebuild, which runs
    // unawaited after first paint — so a shot taken too early has an empty
    // sidebar for a reason that has nothing to do with the sidebar's design.
    await expect(page.getByRole('region', { name: 'Sidebar' }).getByText('economy')).toBeVisible();
  }

  await page.evaluate(() => document.fonts.ready);
}

/**
 * Drops focus before shooting. The editor's text caret blinks, so a focused
 * editor makes the same framing differ between two otherwise identical runs.
 */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * Selects a note and waits for its text to actually be on screen.
 *
 * Clicking the row is not enough: `NoteEditor` is keyed by note id, so a
 * selection change remounts the editor and Tiptap's own mount lands a tick
 * later. The first version of this harness shot the shell immediately after the
 * click and produced a picture of an empty editor pane beside a note list with
 * that note selected — a state the app never actually rests in.
 */
async function openNote(page: Page, name: RegExp, expectText: string): Promise<void> {
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText(expectText);
}

async function shot(target: Page | Locator, name: string): Promise<void> {
  await target.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

for (const theme of THEMES) {
  test.describe(`@shots ${theme.name}`, () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme.colorScheme,
      locale: 'en-US',
      timezoneId: 'Asia/Seoul',
    });

    test(`populated shell @shots`, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await seedDatabase(page, CORPUS);
      await page.goto('/');
      await settle(page);

      const sidebar = page.getByRole('region', { name: 'Sidebar' });
      const list = page.getByRole('region', { name: 'Note list' });
      const editor = page.getByRole('region', { name: 'Editor' });

      await openNote(page, /US market daily/, 'One-line summary');
      await blur(page);

      await shot(page, `01-shell-${theme.name}`);
      await shot(sidebar, `02-sidebar-${theme.name}`);
      await shot(list, `03-note-list-${theme.name}`);
      await shot(editor, `04-editor-rich-${theme.name}`);

      await openNote(page, /Sprint checklist/, 'Density pass');
      await blur(page);
      await shot(editor, `05-editor-todo-${theme.name}`);

      await openNote(page, /A note long enough to scroll/, 'Section 1');
      await blur(page);
      await shot(editor, `06-editor-long-${theme.name}`);

      await page.getByRole('searchbox').fill('market');
      await blur(page);
      await shot(list, `07-note-list-search-${theme.name}`);

      await page.getByRole('searchbox').fill('');
      await sidebar.getByRole('button', { name: /^Trash/ }).click();
      await openNote(page, /Old meeting notes/, 'Superseded by');
      await blur(page);
      await shot(page, `08-trash-${theme.name}`);
    });

    test(`empty shell @shots`, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await page.goto('/');
      await settle(page, { seeded: false });
      await blur(page);

      await shot(page, `09-empty-${theme.name}`);
    });
  });
}
