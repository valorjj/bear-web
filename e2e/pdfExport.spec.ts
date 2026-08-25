import { expect, test } from '@playwright/test';

import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectPdf, leftmostTextX, luminance, pageBackground } from '../server/pdf/inspectPdf.ts';
import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import {
  ADOPTED_SYNC_SETTINGS,
  API_ORIGIN,
  forwardPdfToRenderer,
  RENDERER_URL,
  signIn,
} from './fixtures/renderer.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * Sub-project G's end-to-end proof, and the ONLY place the feature is checked
 * as a whole rather than layer by layer.
 *
 * G exists because the app it was modelled on exports a PDF that ignores the
 * selected theme — every export looks the same whatever you are looking at.
 * "The PDF matches the app exactly" is therefore the claim, and it is a claim
 * about pixels on paper, which no unit test in this repo can see.
 *
 * Three tests, and they are deliberately three different depths:
 *
 *  1. the signed-out affordance — cheap, unconditional;
 *  2. the print-media guard — unconditional, and it needs no renderer at all,
 *     because the test's own browser can be put into print media and asked
 *     what it painted;
 *  3. the real thing — the app's document, the real container, real PDF
 *     bytes, asserted dark. Skipped without `PDF_RENDERER_URL`, because it
 *     cannot be faked into passing and a fake would defeat its purpose.
 */

/**
 * How far inside the page's own content box the text column starts, in CSS
 * pixels, under SCREEN media.
 *
 * Measured, not guessed, and in pixels rather than points because that is what
 * the content stream is in — see `inspectPdf.ts`. Chromium's content-stream
 * origin is the page CONTENT box, so the `@page` margin is already taken out
 * and a document with no padding puts its first text matrix at x = 0 exactly.
 * Established by fault injection: flipping `emulateMedia` to `print` in
 * `render.ts` moved the probe document's leftmost text origin to 0, not to the
 * 28pt its 10mm page margin would have implied.
 *
 * Under screen media the export stylesheet gives `body` a `1.5rem` (24px)
 * side padding and a `--bear-line-width` (40em = 640px) max-width centred in
 * the 673px content box, so the column starts at 40.5px — measured on a real
 * Nord export. Under print media both are zeroed and the text sits at 0.
 */
const MIN_SCREEN_INDENT_PX = 20;

test.describe('PDF export', () => {
  test('a signed-out user is told why PDF is unavailable, and can still reach the item', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('button', { name: 'Export note' }).click();

    const pdf = page.getByRole('menuitem', { name: /PDF/ });

    // `aria-disabled`, not the HTML attribute: a disabled button leaves the
    // tab order, so a keyboard user could never reach it to find out why.
    await expect(pdf).toHaveAttribute('aria-disabled', 'true');
    await expect(pdf).toHaveAccessibleName(/sign in/i);

    /*
     * Reached by keyboard, and activated by keyboard, because that is the
     * whole reason the item is `aria-disabled` rather than `disabled`.
     *
     * `locator.click()` cannot be used here at all: Playwright's actionability
     * check treats `aria-disabled="true"` as "not enabled" and waits for the
     * full timeout rather than clicking. Which means the obvious version of
     * this assertion is impossible to write, not merely wrong — worth knowing
     * before someone reaches for `{ force: true }` and tests a synthetic event
     * no user can produce.
     *
     * Focus opens on the first item (Markdown), so two Tabs land on PDF.
     */
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(pdf).toBeFocused();
    await page.keyboard.press('Enter');

    // Nothing happened: no download, and the menu is still open rather than
    // closing in a way that would look like the export had started.
    await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
    expect(downloaded).toBe(false);
  });

  /**
   * The stronger form of the guarantee `html.test.ts` can only approximate.
   *
   * That unit test asserts the exported stylesheet has no
   * `@media print { html, body { background: none } }`. Its regex names one
   * selector, so a print-media background reset written against `:root`, or
   * `body` alone, or a class, would slip past it untouched — and the visible
   * result is the exact defect G was built to remove.
   *
   * This asks the browser instead: render the real exported document, flip
   * the media type, and read back what was PAINTED (a resolved colour, not
   * the lazily-substituted custom property a `getPropertyValue` would hand
   * back). Any rule, under any selector, that changes the page background
   * for print fails it.
   */
  test('the exported document keeps its dark page background under print media', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bear-web:theme', 'nord');
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');

    await page.getByRole('button', { name: /US market daily/ }).click();
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText('One-line summary');

    await page.getByRole('button', { name: 'Export note' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'HTML' }).click();

    // Saved under a real `.html` name: Playwright's download path has no
    // extension and Chromium then serves it as plain text, so nothing renders
    // and every assertion below would read the same default colour twice.
    const saved = join(tmpdir(), 'bear-web-pdf-print-media.html');
    await (await download).saveAs(saved);
    await page.goto(`file://${saved}`);

    const read = async (): Promise<{ html: string; body: string }> =>
      page.evaluate(() => ({
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
      }));

    await page.emulateMedia({ media: 'screen' });
    const onScreen = await read();

    await page.emulateMedia({ media: 'print' });
    const onPaper = await read();

    // Same colour in both media — the theme owns the page, printed or not.
    expect(onPaper).toEqual(onScreen);

    // And it is genuinely dark, so the equality above cannot be satisfied by
    // both media rendering a white page.
    const paperLuminance = await page.evaluate((colour: string) => {
      const parts = colour.match(/[\d.]+/g) ?? [];
      const channel = (value: number): number =>
        value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

      return (
        0.2126 * channel(Number(parts[0]) / 255) +
        0.7152 * channel(Number(parts[1]) / 255) +
        0.0722 * channel(Number(parts[2]) / 255)
      );
    }, onPaper.body);

    expect(paperLuminance, 'Nord must export a dark page').toBeLessThan(0.1);
  });

  test('a signed-in user downloads a real, dark, screen-media PDF', async ({ page }) => {
    /*
     * Deliberately NOT mirrored on `migrate.test.ts`'s "assert the variable is
     * set whenever CI is". That pattern is right when CI provides the
     * dependency, and CI does not provide this one: `ci.yml` starts a MariaDB
     * service but no renderer, and the renderer image is 3.9 GB — building it
     * on every ubuntu run to render one A4 page is not a trade this repo
     * should make. Asserting the variable under CI would simply turn `main`
     * red.
     *
     * What keeps this from being a suite that silently runs nothing is that
     * the two things it proves each have an UNCONDITIONAL stand-in that CI
     * does run: `server/pdf/fidelity.test.ts` (via `npm run test:pdf`) proves
     * `emulateMedia`/`preferCSSPageSize` against a real Chromium with no
     * container, and the print-media test above proves the dark page against
     * the real exported document with no renderer at all. This test is the
     * one that puts all three together, and it is run by hand — see
     * `server/README.md`.
     */
    test.skip(RENDERER_URL === '', 'set PDF_RENDERER_URL and run `npm run pdf:up`');

    await page.addInitScript(() => {
      localStorage.setItem('bear-web:theme', 'nord');
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, {
      ...CORPUS,
      settings: [...CORPUS.settings, ...ADOPTED_SYNC_SETTINGS],
    });
    await signIn(page);
    await forwardPdfToRenderer(page, RENDERER_URL);

    const posted: string[] = [];
    page.on('request', (request) => {
      if (request.url() === `${API_ORIGIN}/export/pdf`) posted.push(request.method());
    });

    await page.goto('/');
    await page.getByRole('button', { name: /US market daily/ }).click();
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText('One-line summary');

    await page.getByRole('button', { name: 'Export note' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /^PDF/ }).click();
    const saved = await download;

    expect(posted, 'the client must send the document to the API').toEqual(['POST']);
    expect(saved.suggestedFilename()).toMatch(/\.pdf$/);

    const bytes = await readFile((await saved.path())!);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const content = inspectPdf(bytes);

    // A4, from the export stylesheet's own `@page` — `preferCSSPageSize`.
    expect(content.widthPt).toBeCloseTo(595.28, 0);
    expect(content.heightPt).toBeCloseTo(841.89, 0);

    // THE assertion. Nord's `--bear-bg` reached the paper as a real painted
    // rectangle in the content stream. If `emulateMedia({ media: 'screen' })`
    // were dropped, or `printBackground` were, or a print stylesheet reset
    // the page, this is what would go white.
    const background = pageBackground(content);
    expect(background, 'the PDF has no page-covering fill at all').not.toBeNull();
    if (background === null) return;
    expect(luminance(background), 'a Nord export must be a dark PDF').toBeLessThan(0.1);

    // Independent of colour: under print media the export stylesheet zeroes
    // `body`'s `max-width` (only), so the centred column would collapse to
    // the page's full printable width. Under screen media the centred,
    // padded column starts well inside the page edge.
    const x = leftmostTextX(content);
    expect(x, 'no text matrix in the content stream').not.toBeNull();
    if (x === null) return;
    expect(x, 'text at x=0 means print media applied').toBeGreaterThan(MIN_SCREEN_INDENT_PX);
  });
});
