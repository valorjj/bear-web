import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

/*
 * `exact` is load-bearing. A note-list row's accessible name contains the
 * note's body text, so a note that merely MENTIONS typography also matches
 * `{ name: 'Typography' }` and Playwright fails on a strict-mode violation
 * naming two elements. Found the first time this spec's fixture used the word.
 */
const TRIGGER = { name: 'Typography', exact: true } as const;

const fontSize = (page: Page): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bear-font-size').trim(),
  );

test('a chosen size applies live and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Reading comfort');

  await page.getByRole('button', TRIGGER).click();
  await page.getByRole('slider', { name: 'Font size' }).fill('21');

  // Live, with no commit and no reload: the panel writes the token directly.
  await expect(editor).toHaveCSS('font-size', '21px');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  expect(await fontSize(page)).toBe('21px');
  await page.getByRole('button', { name: /Reading comfort/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCSS('font-size', '21px');
});

/*
 * The mirror exists solely to beat first paint, so asserting after load proves
 * nothing — a late-applying implementation ends up correct too, just with the
 * whole note reflowing on every launch.
 *
 * The discriminator is `<body>`: the inline script sits in `<head>` and runs
 * while the parser is still inside the head, before `<body>` exists, where any
 * JavaScript-driven alternative necessarily runs after the document is parsed.
 *
 * The init script must NOT touch `document.documentElement` at
 * `document_start` — it is null there, and the throw is silent and looks
 * exactly like "never applied".
 */
test('the typography is applied before first paint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', TRIGGER).click();
  await page.getByRole('slider', { name: 'Font size' }).fill('21');
  await page.getByRole('button', { name: 'Done' }).click();
  expect(await fontSize(page)).toBe('21px');

  await page.addInitScript(() => {
    const record: string[] = [];
    (window as unknown as { __atBody: string[] }).__atBody = record;
    new MutationObserver((_records, observer) => {
      if (document.body === null) return;
      record.push(document.documentElement.style.getPropertyValue('--bear-font-size'));
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });

  await page.reload();

  const atBody = await page.evaluate(() => (window as unknown as { __atBody: string[] }).__atBody);
  expect(atBody.length, 'the observer never saw body appear').toBe(1);
  expect(atBody[0], 'the typography was not applied until after the document was parsed').toBe(
    '21px',
  );
});

test('a corrupt or out-of-range mirror renders the defaults rather than breaking boot', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('bear-web:typography', '{oh no'));
  await page.goto('/');
  await expect(page.getByRole('button', TRIGGER)).toBeVisible();
  expect(await fontSize(page)).toBe('16px');

  // A well-formed entry holding a value outside its bound — the shape a hand
  // edit in devtools produces, and the one a narrowed bound would produce for
  // an entry written by an older build.
  await page.addInitScript(() =>
    localStorage.setItem(
      'bear-web:typography',
      JSON.stringify({
        fontSize: 0,
        lineHeight: 1.6,
        lineWidth: 40,
        paraSpacing: 0,
        paraIndent: 0,
      }),
    ),
  );
  await page.reload();
  expect(await fontSize(page), 'an out-of-range value was painted').toBe('16px');

  /*
   * `1e999`, which is the only way a non-finite number reaches the pre-paint
   * path: that path is `JSON.parse`, and JSON has no NaN or Infinity literal,
   * but `1e999` is valid JSON and parses to `Infinity`.
   *
   * Stated precisely because the comment here first claimed to test NaN and
   * did not. NaN is unreachable through the mirror — though NOT through the
   * durable row, which IndexedDB stores by structured clone and which CAN
   * hold one, so `isTypography` in `typography.ts` does face it and
   * `typography.test.ts` covers it there.
   */
  await page.addInitScript(() =>
    localStorage.setItem(
      'bear-web:typography',
      '{"fontSize":1e999,"lineHeight":1.6,"lineWidth":40,"paraSpacing":0,"paraIndent":0}',
    ),
  );
  await page.reload();
  expect(await fontSize(page), 'a non-finite value was painted').toBe('16px');
});

/*
 * jsdom has the range ELEMENT but not the range WIDGET — no layout and no key
 * handling — so `TypographyPanel.test.tsx` drives its sliders with
 * `fireEvent.change` and nothing in the unit suite can prove a real slider
 * responds to a real key. This is the only place that does.
 */
test('a real slider responds to the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', TRIGGER).click();
  const slider = page.getByRole('slider', { name: 'Font size' });
  await slider.focus();

  await page.keyboard.press('ArrowRight');
  expect(await fontSize(page)).toBe('17px');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await fontSize(page)).toBe('15px');

  await page.getByRole('button', { name: 'Reset' }).click();
  expect(await fontSize(page)).toBe('16px');
});

test('the chosen typography reaches an exported document, headings included', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('A plain first line');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('# Heading one');

  await page.getByRole('button', TRIGGER).click();
  await page.getByRole('slider', { name: 'Font size' }).fill('21');
  await page.getByRole('slider', { name: 'Line width' }).fill('50');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Export note' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'HTML' }).click();

  // Saved under a real `.html` name before it is loaded below: Playwright's own
  // download path has no extension, and Chromium then serves it as plain text.
  const path = join(tmpdir(), 'bear-web-typography-export.html');
  await (await download).saveAs(path);
  const text = await readFile(path, 'utf8');
  expect(text).toContain('--bear-font-size: 21px');
  expect(text).toContain('--bear-line-width: 50em');

  /*
   * Rendered, not string-matched. A `toContain` on the stylesheet proves the
   * declaration is present, never that anything USES it — the same gap that
   * let the export ship the pre-M9a heading scale for two milestones.
   */
  await page.goto(`file://${path}`);
  const measured = await page.evaluate(() => {
    const first = document.body.firstElementChild!;
    const h1 = document.querySelector('h1')!;
    return {
      body: getComputedStyle(document.body).fontSize,
      title: getComputedStyle(first).fontSize,
      titleWeight: getComputedStyle(first).fontWeight,
      h1: getComputedStyle(h1).fontSize,
    };
  });

  // 21 x 1.2^3 = 36.288. The old literals would give 21 x 1.6 = 33.6.
  expect(measured.body).toBe('21px');
  expect(Number.parseFloat(measured.h1)).toBeCloseTo(36.29, 1);
  expect(Number.parseFloat(measured.title)).toBeCloseTo(36.29, 1);
  expect(measured.titleWeight).toBe('700');
});

test('the panel is reachable and fits on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // On a phone the sidebar is its own screen, reached from the note list.
  await page.getByRole('button', { name: 'Show tags' }).click();
  await page.getByRole('button', TRIGGER).click();
  await expect(page.getByRole('dialog', { name: 'Typography' })).toBeVisible();

  await page.getByRole('slider', { name: 'Line height' }).fill('1.9');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bear-line-height').trim(),
    ),
  ).toBe('1.9');

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
    'the panel overflows the phone viewport horizontally',
  ).toBe(false);
});
