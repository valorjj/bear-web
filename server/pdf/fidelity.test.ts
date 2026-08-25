import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectPdf, leftmostTextX, luminance, pageBackground } from './inspectPdf.ts';
import { renderPdf } from './render.ts';

/**
 * The two render options G's entire claim rests on, made falsifiable.
 *
 * `render.ts` sets `emulateMedia({ media: 'screen' })` and
 * `preferCSSPageSize: true`. Until this file, NOTHING anywhere tested either.
 * That matters more than it sounds: `page.pdf()` applies PRINT media by
 * default, and print media is exactly where a theme's page background
 * historically got thrown away — "the PDF ignores your theme" is the defect
 * sub-project G exists to fix. Drop the `emulateMedia` line and every other
 * assertion in this repo still passes.
 *
 * The document below is a PROBE, not a sample export. It is built so each
 * option has a visible, opposite consequence:
 *
 *   - `@page { size: A5 }` — honoured only with `preferCSSPageSize`. Without
 *     it Playwright's own default (Letter) wins, and the two sizes are
 *     nowhere near each other.
 *   - a dark background with a WHITE `@media print` override — so the paper
 *     comes out dark under screen media and white under print.
 *   - a 40mm text indent zeroed under `@media print` — so the text origin
 *     moves 113 points depending which media applies.
 *
 * The colour literals here are deliberate and are not theme values: they are
 * probe extremes chosen to be unmistakable, in a test file outside `src/`.
 * The rule they would otherwise break — every colour comes from a custom
 * property — is about the app's own styling.
 */
const A5_WIDTH_PT = 419.53;
const A5_HEIGHT_PT = 595.28;

/**
 * 40mm, in CSS pixels: the indent that only screen media keeps.
 *
 * Pixels, not points. The content stream's units are CSS pixels — Chromium
 * wraps the page in a 0.75 scale, so `/MediaBox` is in points and everything
 * inside it is not. See `inspectPdf.ts`. 90% of the nominal value, because
 * the mm-to-px conversion lands on a subpixel and the text matrix is rounded.
 */
const INDENT_PX = (40 / 25.4) * 96 * 0.9;

const PROBE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: A5; margin: 10mm; }
      html, body { margin: 0; padding: 0; background: #0b0b14; color: #f2f2ff; }
      p { margin: 0 0 0 40mm; font-size: 12pt; }
      @media print {
        html, body { background: #ffffff; color: #000000; }
        p { margin-left: 0; }
      }
    </style>
  </head>
  <body><p>fidelity probe</p></body>
</html>
`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe('the renderer prints the document as the SCREEN shows it', () => {
  let pdf: Uint8Array;

  beforeAll(async () => {
    pdf = await renderPdf(PROBE, { browser, timeoutMs: 20_000 });
  }, 60_000);

  it('takes its page size from the document, not from a renderer default', () => {
    // `preferCSSPageSize: true`. Remove it and this is Letter, 612 x 792.
    const content = inspectPdf(pdf);

    expect(content.widthPt).toBeCloseTo(A5_WIDTH_PT, 0);
    expect(content.heightPt).toBeCloseTo(A5_HEIGHT_PT, 0);
  });

  it('paints the page background the document asks for, not the print-media white', () => {
    // The heart of it. Under print media this page is #ffffff — luminance 1.
    const background = pageBackground(inspectPdf(pdf));

    expect(background, 'no page-covering fill: printBackground regressed').not.toBeNull();
    if (background === null) return;

    expect(luminance(background)).toBeLessThan(0.05);
  });

  it('lays the text out under screen media, not print media', () => {
    // Independent of colour, so a future change to `printBackground` cannot
    // make the media assertion above pass for the wrong reason. Under print
    // media the indent is zero and the text sits at x = 0 exactly — MEASURED,
    // by flipping `emulateMedia` in `render.ts`: the page margin is already
    // outside the content stream's origin, so print media does not put the
    // text at 10mm either. Under screen media it sits 40mm further right.
    const x = leftmostTextX(inspectPdf(pdf));

    expect(x, 'no text matrix in the content stream').not.toBeNull();
    if (x === null) return;

    expect(x).toBeGreaterThan(INDENT_PX);
  });
});
