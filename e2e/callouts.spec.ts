import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

const TYPES = ['info', 'tip', 'success', 'warning', 'danger'] as const;

const NOTE = [
  'Callouts',
  '',
  ...TYPES.flatMap((type) => [`> [!${type}] ${type} header`, '>', `> ${type} body.`, '']),
  '> [!사내공지] 제목',
  '>',
  '> 본문.',
  '',
  '> just a quote',
].join('\n');

const AT = Date.UTC(2026, 7, 18, 5, 30);

async function open(page: Page, text: string): Promise<void> {
  await seedDatabase(page, {
    notes: [
      {
        id: 'n1',
        title: 'Callouts',
        text,
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
  await page.getByRole('button', { name: /Callouts/ }).click();
  await expect(page.locator('.ProseMirror blockquote').first()).toBeVisible();
}

test('every type renders as its own tinted panel', async ({ page }) => {
  await open(page, NOTE);

  for (const type of TYPES) {
    const panel = page.locator(`.ProseMirror blockquote[data-callout="${type}"]`);
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('[data-callout-title]')).toHaveText(`${type} header`);
  }

  // A plain quote and an unrecognised marker both stay quotes — neither may
  // invent a colour. Seven blockquotes, five of them callouts.
  await expect(page.locator('.ProseMirror blockquote')).toHaveCount(7);
  await expect(page.locator('.ProseMirror blockquote[data-callout]')).toHaveCount(5);
});

test('the five fills are visibly different from each other and from the page', async ({ page }) => {
  // The unit suite cannot see this at all and `e2e/contrast.spec.ts` checks
  // each fill against the page in isolation — neither can catch two types
  // resolving to the SAME colour, which is what a copy-paste slip in
  // `tokens.css` produces and what makes a warning indistinguishable from a
  // danger at a glance.
  await open(page, NOTE);

  const fills = await Promise.all(
    TYPES.map((type) =>
      page
        .locator(`.ProseMirror blockquote[data-callout="${type}"]`)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ),
  );

  const page_ = await page
    .locator('.ProseMirror')
    .evaluate((element) => getComputedStyle(element).backgroundColor);

  expect(new Set(fills).size, `fills were not distinct: ${fills.join(', ')}`).toBe(TYPES.length);
  expect(fills).not.toContain(page_);
});

test('the header draws a glyph, which is the half a colour cannot carry', async ({ page }) => {
  await open(page, NOTE);

  const mask = await page
    .locator('.ProseMirror blockquote[data-callout="warning"] [data-callout-title]')
    .evaluate((element) => getComputedStyle(element, '::before').maskImage);

  expect(mask).toContain('data:image/svg+xml');
});

test('an untitled callout shows its type name as a hint that never reaches the note', async ({
  page,
}) => {
  await open(page, 'Callouts\n\n> [!warning]');

  const title = page.locator(
    '.ProseMirror blockquote[data-callout="warning"] [data-callout-title]',
  );
  await expect(title).toHaveAttribute('data-placeholder', /Warning|경고/);

  // The hint is a decoration, so it is not in the document. If it ever became
  // content, the note's own text would gain a word the user never typed.
  await expect(title).toHaveText('');
});

test('the chevron menu switches a type, and the note text follows', async ({ page }) => {
  await open(page, 'Callouts\n\n> [!warning] Be careful\n>\n> Body.');

  // The caret has to be IN the callout, exactly as a user would put it: the
  // menu reflects the block under the cursor, so opening it from a caret
  // parked on the title would report a plain quote — and choosing a type
  // would then make a NEW callout out of the title instead of switching this
  // one. Verified: without this click the menu opens with Warning unchecked.
  await page.locator('.ProseMirror blockquote[data-callout="warning"] p').last().click();

  await page.getByRole('button', { name: /Callout type|칼아웃 종류/ }).click();
  const menu = page.getByRole('menu', { name: /Callout type|칼아웃 종류/ });
  await expect(menu.getByRole('menuitemradio', { name: /Warning|경고/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await menu.getByRole('menuitemradio', { name: /Danger|위험/ }).click();

  await expect(page.locator('.ProseMirror blockquote[data-callout="danger"]')).toHaveCount(1);
  await expect(page.locator('.ProseMirror blockquote[data-callout="warning"]')).toHaveCount(0);
});

test('the note list previews the title, not the marker', async ({ page }) => {
  await open(page, 'Callouts\n\n> [!warning] Be careful\n>\n> Body.');

  const row = page.getByRole('button', { name: /Callouts/ });
  const text = (await row.innerText()).replace(/\s+/g, ' ');

  expect(text).toContain('Be careful');
  expect(text).not.toContain('[!warning]');
});

test('typing the marker converts the line, and typing a bare quote still works', async ({
  page,
}) => {
  // Both halves matter, and the second one is why this test exists at all.
  // `extend({ addInputRules })` REPLACES the base implementation rather than
  // adding to it, so the first version of `Callout` silently cost Blockquote
  // its own `> ` rule — typing a quote stopped producing one. No unit test
  // could see it, because none of them type; `e2e/appearance.spec.ts` caught
  // it by measuring a quote that was never rendered.
  await seedDatabase(page, { notes: [], settings: [] });
  await page.goto('/');
  await page.getByRole('button', { name: /New note|새 메모/ }).click();

  const editor = page.getByRole('textbox', { name: /Note text|메모 내용/ });
  await editor.click();
  await editor.pressSequentially('Title');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('> [!warning] ');
  await editor.pressSequentially('Be careful');

  await expect(page.locator('.ProseMirror blockquote[data-callout="warning"]')).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('> plain quote');

  await expect(page.locator('.ProseMirror blockquote:not([data-callout])')).toHaveCount(1);
});
