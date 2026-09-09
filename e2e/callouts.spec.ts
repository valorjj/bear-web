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

test('the callout menu switches a type, and the note text follows', async ({ page }) => {
  await open(page, 'Callouts\n\n> [!warning] Be careful\n>\n> Body.');

  // The caret has to be IN the callout, exactly as a user would put it: the
  // menu reflects the block under the cursor, so opening it from a caret
  // parked on the title would report a plain quote — and choosing a type
  // would then make a NEW callout out of the title instead of switching this
  // one. Verified: without this click the menu opens with Warning unchecked.
  await page.locator('.ProseMirror blockquote[data-callout="warning"] p').last().click();

  await page.getByRole('button', { name: /Quote or callout|인용 또는 콜아웃/ }).click();
  const menu = page.getByRole('menu', { name: /Callout type|칼아웃 종류/ });
  await expect(menu.getByRole('menuitemradio', { name: /Warning|경고/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await menu.getByRole('menuitemradio', { name: /Danger|위험/ }).click();

  await expect(page.locator('.ProseMirror blockquote[data-callout="danger"]')).toHaveCount(1);
  await expect(page.locator('.ProseMirror blockquote[data-callout="warning"]')).toHaveCount(0);
});

test('the callout menu opens over the button that opened it', async ({ page }) => {
  // The defect this pins: the menu used to render as a centred child of a flex
  // column above the toolbar, so it floated over the middle of the pane while
  // its opener sat at the strip's right-hand end — "its location is not right
  // at all". Only a real layout engine can see this; jsdom has none, and the
  // component test can only check that two different anchors give two
  // different positions.
  await open(page, 'Callouts\n\n> [!warning] Be careful\n>\n> Body.');
  await page.locator('.ProseMirror blockquote[data-callout="warning"] p').last().click();

  const button = page.getByRole('button', { name: /Quote or callout|인용 또는 콜아웃/ });
  await button.click();
  const menu = page.getByRole('menu', { name: /Callout type|칼아웃 종류/ });
  await expect(menu).toBeVisible();

  // `useAnchoredMenu` paints once at the anchor and CORRECTS after measuring
  // its own height, so the FIRST frame is deliberately the un-flipped
  // position. `toBeVisible()` resolves on that frame and a one-shot
  // `boundingBox()` then reads it — measured, not guessed: this assertion
  // failed at `menu.bottom = 879` against a `button.top = 668` until it
  // polled, while the settled geometry is 664 against 668.
  await expect
    .poll(async () => {
      const b = await button.boundingBox();
      const m = await menu.boundingBox();
      return b !== null && m !== null && m.y + m.height <= b.y;
    })
    .toBe(true);

  const buttonBox = (await button.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;

  // Horizontally connected to its opener: the two boxes overlap. A centred
  // menu on a wide pane does not, which is what makes this fail against the
  // old behaviour rather than merely describe the new one.
  expect(menuBox.x).toBeLessThan(buttonBox.x + buttonBox.width);
  expect(menuBox.x + menuBox.width).toBeGreaterThan(buttonBox.x);

  // Clamped inside the viewport rather than running off the right edge — the
  // opener is near the end of the strip, which is exactly where an unclamped
  // menu would escape.
  const viewport = page.viewportSize()!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
});

test('clicking the callout button again closes its menu', async ({ page }) => {
  // A toggle button must be able to close its own popup. The dismissal
  // listener runs during CAPTURE, so without excluding the opener it closes on
  // mousedown and the button's click re-opens a render later — the menu the
  // user clicked to dismiss simply stays.
  await open(page, 'Callouts\n\n> [!warning] Be careful\n>\n> Body.');
  await page.locator('.ProseMirror blockquote[data-callout="warning"] p').last().click();

  const button = page.getByRole('button', { name: /Quote or callout|인용 또는 콜아웃/ });
  const menu = page.getByRole('menu', { name: /Callout type|칼아웃 종류/ });

  await button.click();
  await expect(menu).toBeVisible();

  await button.click();
  await expect(menu).toBeHidden();
});

/**
 * Clicks into a callout's title and waits until ProseMirror has actually taken
 * the caret, not merely until the DOM selection moved.
 *
 * A `.click()` sets the browser selection immediately; ProseMirror syncs it
 * into its own state on a later `selectionchange`. Pressing a key in that gap
 * runs the keymap against the PREVIOUS selection — measured: with the caret
 * visibly in an empty callout title, the handler saw a `paragraph` of size 8
 * at depth 1, which is the note's first line. Both tests below then passed
 * VACUOUSLY, because a Backspace aimed at the wrong block cannot damage the
 * callout either.
 *
 * The toolbar button's `aria-pressed` is the app's own selection-driven
 * signal — it reads `flags.blockquote` — so waiting on it proves the state
 * caret really is inside the callout. Nothing cheaper is trustworthy here:
 * the DOM selection is already correct while the state's is not, so polling
 * `window.getSelection()` would confirm exactly the wrong thing.
 */
async function caretInto(page: Page, callout: ReturnType<Page['locator']>): Promise<void> {
  await callout.locator('[data-callout-title]').click();
  await expect(
    page.getByRole('button', { name: /Quote or callout|인용 또는 콜아웃/ }),
  ).toHaveAttribute('aria-pressed', 'true');
}

test('Backspace in an empty title cannot strip the icon or the type', async ({ page }) => {
  // The user's report: "I can remove the icon." The icon is a CSS `::before`
  // on the title node, and the schema made that node optional, so one
  // Backspace destroyed all three at once — glyph, `data-callout`, and the
  // `[!danger]` marker in the saved text. Asserting the PAINTED pseudo-element
  // is the point: a check on the node alone would pass against a build where
  // the icon had stopped rendering for some other reason.
  await open(page, 'Callouts\n\n> [!danger]\n>\n> aaaaaaa');

  const callout = page.locator('.ProseMirror blockquote[data-callout="danger"]');
  await expect(callout).toHaveCount(1);

  const maskOf = async (): Promise<string> =>
    callout
      .locator('[data-callout-title]')
      .evaluate((el) => getComputedStyle(el, '::before').maskImage);

  const before = await maskOf();
  expect(before).not.toBe('none');
  expect(before).not.toBe('');

  await caretInto(page, callout);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');

  await expect(callout).toHaveCount(1);
  expect(await maskOf()).toBe(before);
});

test('Backspace still escapes a callout with nothing in it', async ({ page }) => {
  // The escape hatch, and the only case where the icon may go: it leaves with
  // the whole callout, never on its own.
  await open(page, 'Callouts\n\n> [!success]');

  const callout = page.locator('.ProseMirror blockquote[data-callout="success"]');
  await expect(callout).toHaveCount(1);

  await caretInto(page, callout);
  await page.keyboard.press('Backspace');

  await expect(callout).toHaveCount(0);
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
