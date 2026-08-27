import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

/**
 * The note from the report, verbatim: a coloured highlight in the body, which
 * `Highlight.ts` serializes to real inline HTML rather than to a delimiter.
 * The list row printed the tag and its class attribute.
 */
const MARKED_UP = [
  'TEST',
  'hi <mark class="hl-green">abcd</mark> hi, this is good.',
  '',
  '| a | b | c |',
  '| --- | --- | --- |',
  '',
  'and **bold** with `code` and [a link](https://example.com).',
].join('\n');

const AT = Date.UTC(2026, 7, 18, 5, 30);

test('the note list previews prose, never Markdown or HTML syntax', async ({ page }) => {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n1',
        title: 'TEST',
        text: MARKED_UP,
        createdAt: AT,
        updatedAt: AT,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });
  await page.goto('/');

  const row = page.getByRole('button', { name: /TEST/ });
  await expect(row).toBeVisible();

  // The row's own text, not the editor's — the editor is where syntax
  // belongs, and this assertion must not accidentally read it.
  const rowText = (await row.innerText()).replace(/\s+/g, ' ');

  expect(rowText).toContain('hi abcd hi, this is good.');
  expect(rowText).not.toContain('<mark');
  expect(rowText).not.toContain('hl-green');
  expect(rowText).not.toContain('**');
  expect(rowText).not.toContain('`');
  expect(rowText).not.toContain('https://example.com');
  // The table's cells were already dropped before this change; kept here so a
  // rewrite of the stripper cannot quietly reintroduce them.
  expect(rowText).not.toContain('| ---');
});

test('creating a note puts the caret on its title line', async ({ page }) => {
  await seedDatabase(page, { notes: [], settings: [] });
  await page.goto('/');

  await page.getByRole('button', { name: /New note|새 메모/ }).click();

  const surface = page.getByRole('textbox', { name: /Note text|메모 내용/ });
  await expect(surface).toBeFocused();

  // Typing must name the note, which is the whole point: a caret parked
  // anywhere else would put these characters somewhere other than the title.
  await page.keyboard.type('Named by typing');
  await expect(page.getByRole('button', { name: /Named by typing/ })).toBeVisible();
});
