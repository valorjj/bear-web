import { expect, test } from '@playwright/test';

import type { Corpus, SeedNote } from './fixtures/corpus.ts';
import { FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * Diagram end-to-end coverage, entirely mocked at `/diagram`.
 *
 * Deliberately does NOT need a running container: `page.route` intercepts
 * every request, so this suite runs in `npm run test:e2e` unconditionally.
 * The real container is exercised separately by `shots-mermaid.spec.ts`,
 * which needs `PDF_RENDERER_URL` and is skipped without it.
 *
 * `diagramNote` is local to this file rather than added to
 * `e2e/fixtures/corpus.ts` — that corpus drives the 256-file `shots` harness
 * and `measure.spec.ts`'s committed `measurements.md`, and a new note there
 * changes note-list geometry for reasons that have nothing to do with
 * diagrams. (Recorded ruling.)
 */

const diagramNote: SeedNote = {
  id: 'diagram-note',
  title: 'Diagram Note',
  text: '# Diagram Note\n\n```mermaid\nflowchart TD\n  A --> B\n```\n',
  createdAt: FIXED_NOW - 60_000,
  updatedAt: FIXED_NOW - 60_000,
  pinned: false,
  trashedAt: null,
  archivedAt: null,
};

const corpus: Corpus = { notes: [diagramNote], settings: [] };

/**
 * Picks a theme through the paint-time mirror, the way a user actually does
 * it — opening the picker and clicking a card — rather than by driving
 * `colorScheme`, which is the media query and once silently rendered the
 * wrong theme in `npm run shots` until M9a caught it.
 */
async function selectTheme(page: import('@playwright/test').Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: /theme|테마/i }).click();
  await page.getByRole('radio', { name }).click();
}

test('renders a diagram, once, across a theme switch', async ({ page }) => {
  let calls = 0;
  await page.route('**/diagram', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" id="drawn"><text fill="var(--bear-text)">Start</text></svg>',
    });
  });

  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, corpus);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(diagramNote.title) }).click();

  await expect(page.locator('svg#drawn')).toBeVisible();
  expect(calls).toBe(1);

  await selectTheme(page, /^(Nord|노드)$/);

  await expect(page.locator('svg#drawn')).toBeVisible();
  // The claim the spec makes: one render serves every theme. Asserted by
  // request count, not merely "still visible" — the diagram would still be
  // visible even if the theme switch silently re-fetched it.
  expect(calls).toBe(1);
});

test('shows the source and a reason when the render fails', async ({ page }) => {
  await page.route('**/diagram', (route) => route.abort('failed'));

  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, corpus);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(diagramNote.title) }).click();

  const editor = page.getByRole('region', { name: 'Editor' });
  await expect(editor.getByText('Diagrams need a connection.')).toBeVisible();
  await expect(editor.getByText('flowchart TD')).toBeVisible();
});

test('the diagram carries an accessible name', async ({ page }) => {
  await page.route('**/diagram', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
  });

  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, corpus);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(diagramNote.title) }).click();

  await expect(page.getByRole('img', { name: 'Diagram: flowchart TD' })).toBeVisible();
});
