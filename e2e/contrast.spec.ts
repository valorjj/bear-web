import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { composite, contrastRatio, parseColour } from '../scripts/contrast';
import { readThemeTokens } from './fixtures/tokens.ts';

/**
 * The theme roster, read from disk rather than imported.
 *
 * `tsconfig.e2e.json` declares no `paths`, so the `@/` alias inside
 * `src/styles/themes.ts` would not resolve under this project, and no e2e spec
 * imports from `src/` today. Parsing the ids keeps that boundary intact while
 * still driving the harness from the one roster everything else agrees with —
 * `scripts/sourceLint.test.ts` is what holds the roster and the CSS together.
 */
const THEME_IDS = [
  ...readFileSync('src/styles/themes.ts', 'utf8').matchAll(/id: '([a-z-]+)'/g),
].map((match) => match[1]!);

/**
 * Foreground token → the grounds it is actually PAINTED on → its floor.
 *
 * The grounds are audited, not assumed. A pair the app never renders is not
 * evidence of anything, and demanding a ratio for one would push a real
 * palette around to satisfy an imaginary requirement:
 *
 *   - `canvas` is not a text ground. `bg-canvas` occurs once, on `<main>`,
 *     whose only children are the three panes and the resizers; every pane
 *     paints its own background over it. No glyph is ever drawn on canvas.
 *   - `accent` and `danger` are not text on `sidebar`. A selected sidebar row
 *     is `text-text` on `bg-selected`; the accent appears there only as the 2px
 *     edge marker, a graphical object. Accent-as-text is the search highlight
 *     and the pin glyph (note list, `surface`) and editor links (`bg`).
 */
const RULES = [
  { fg: 'text', grounds: ['bg', 'surface', 'sidebar'], min: 4.5 },
  { fg: 'muted', grounds: ['bg', 'surface', 'sidebar'], min: 4.5 },
  // 3.0 is already the relaxed bar: `faint` carries counts and timestamps.
  { fg: 'faint', grounds: ['bg', 'surface', 'sidebar'], min: 3.0 },
  { fg: 'accent', grounds: ['bg', 'surface'], min: 4.5 },
  { fg: 'danger', grounds: ['bg', 'surface'], min: 4.5 },
  /*
   * The syntax palette is body-size text on `surface` — the `pre` background —
   * and nowhere else. Five roles sit at 4.5 with `text` and `accent`.
   *
   * `code-comment` is held to 3.0, and the justification is `faint`'s two
   * entries above rather than a new one: secondary information a reader skims.
   * A comment at 4.5:1 cannot be dim, and a dim comment is the universal
   * convention. This is the ONLY relaxation in the palette — do not lower the
   * other five to keep a scheme faithful.
   */
  { fg: 'code-keyword', grounds: ['surface'], min: 4.5 },
  { fg: 'code-string', grounds: ['surface'], min: 4.5 },
  { fg: 'code-number', grounds: ['surface'], min: 4.5 },
  { fg: 'code-comment', grounds: ['surface'], min: 3.0 },
  { fg: 'code-function', grounds: ['surface'], min: 4.5 },
  { fg: 'code-type', grounds: ['surface'], min: 4.5 },
  /*
   * A table cell's prose, on the two grounds a table actually paints: the
   * striped body row and the shaded header. Both tokens are derived from
   * `--bear-bg` in `srgb` (see `tokens.css`), so this row is the whole
   * verification that neither derivation can dim a cell's text below AA in
   * any theme, present or future.
   */
  { fg: 'text', grounds: ['table-stripe', 'table-header'], min: 4.5 },
] as const;

/**
 * Decorative, and deliberately held to a much lower bar than 3.0.
 *
 * WCAG's 3:1 non-text threshold covers visual information REQUIRED to identify
 * a control or understand content. `--bear-border` draws row dividers and pane
 * hairlines: a row is identified by its text, and the divider only has to be
 * perceptible. Both shipped palettes measure 1.2–1.4 here, and they were
 * designed and reviewed that way — holding them to 3.0 would drive heavy dark
 * rules through Paper and Ink to satisfy a rule that does not apply.
 *
 * What this DOES catch is the one unambiguous defect: a border that resolves
 * equal to its own ground — an invisible divider, scoring exactly 1.0. The
 * floor sits just above that and no higher, because "faint but present" is a
 * design judgement and this test has no standing to make it. High Contrast
 * clears it by an enormous margin on purpose — white on black — and that
 * spread is the point of having the theme in the roster.
 */
/**
 * A callout's edge — the left bar and the type icon — is a graphical object,
 * not text, so 3.0 rather than 4.5. It is held to a real bar rather than to
 * `border`'s 1.05 because it is the only thing distinguishing a warning from a
 * danger at a glance: an edge that fades into the page defeats the block.
 *
 * The FILL is checked separately, in OVERLAYS, because it is alpha and the
 * body text has to survive the composite.
 */
const CALLOUT_EDGES = [
  { fg: 'cal-edge-info', grounds: ['bg'], min: 3.0 },
  { fg: 'cal-edge-tip', grounds: ['bg'], min: 3.0 },
  { fg: 'cal-edge-success', grounds: ['bg'], min: 3.0 },
  { fg: 'cal-edge-warning', grounds: ['bg'], min: 3.0 },
  { fg: 'cal-edge-danger', grounds: ['bg'], min: 3.0 },
] as const;

/**
 * The panel must be visible AS a panel.
 *
 * Without this the fill rows in OVERLAYS are vacuous in the worst way: a fill
 * identical to `--bear-bg` passes a 4.5 check against `text` perfectly, so a
 * callout that had silently stopped tinting anything would sail through the
 * suite. Held to `border`'s own floor, because a panel edge nobody can see is
 * the same defect as a hairline nobody can see.
 */
const CALLOUT_FILLS_ARE_VISIBLE = [
  { fg: 'cal-fill-info', grounds: ['bg'], min: 1.05 },
  { fg: 'cal-fill-tip', grounds: ['bg'], min: 1.05 },
  { fg: 'cal-fill-success', grounds: ['bg'], min: 1.05 },
  { fg: 'cal-fill-warning', grounds: ['bg'], min: 1.05 },
  { fg: 'cal-fill-danger', grounds: ['bg'], min: 1.05 },
] as const;

const DECORATIVE = [
  { fg: 'border', grounds: ['bg', 'surface', 'sidebar'], min: 1.05 },
  /*
   * The stripe and the header must be VISIBLE as a step from the page, and
   * this row is not redundant with the 4.5 rule above it — it is the half
   * that catches the opposite failure. A stripe that collapsed into
   * `--bear-bg` passes a 4.5 check against `text` perfectly (it IS the page),
   * so striping that had silently stopped rendering would sail through.
   * `high-contrast` really did: `color-mix(in oklab, #000000 94%, #ffffff)`
   * clamps back to `#000000` and scored 1.004 here, which is what sent both
   * tokens to `srgb`. Held to `border`'s own floor for the same reason —
   * "faint but present" is a design judgement this test has no standing to
   * make, and an invisible one is the unambiguous defect.
   */
  { fg: 'table-stripe', grounds: ['bg'], min: 1.05 },
  { fg: 'table-header', grounds: ['bg'], min: 1.05 },
  ...CALLOUT_EDGES,
  ...CALLOUT_FILLS_ARE_VISIBLE,
] as const;

/**
 * Overlays are alpha over a ground, and text has to survive the composite.
 * This is the half that could never be checked by hand at scale, and the half
 * jsdom cannot do at all.
 */
const OVERLAYS = [
  { overlay: 'selected', ground: 'surface', fg: 'text', min: 4.5 },
  { overlay: 'hover', ground: 'surface', fg: 'text', min: 4.5 },
  { overlay: 'tag-fill', ground: 'bg', fg: 'accent', min: 3.0 },
  // A highlight is body text on a tinted page: the fill must not eat the text
  // it exists to draw attention to. `bg` is the ground because a highlight is
  // always inside the editor's own canvas, never on a sidebar or a popover.
  { overlay: 'hl-blue', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'hl-green', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'hl-pink', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'hl-purple', ground: 'bg', fg: 'text', min: 4.5 },
  // A callout's body is ordinary prose on a tinted panel, and the panel exists
  // to draw the eye rather than to hide the words. `bg` is the ground for the
  // same reason a highlight's is: a callout is always inside the editor's own
  // canvas, never on a sidebar or a popover.
  { overlay: 'cal-fill-info', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'cal-fill-tip', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'cal-fill-success', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'cal-fill-warning', ground: 'bg', fg: 'text', min: 4.5 },
  { overlay: 'cal-fill-danger', ground: 'bg', fg: 'text', min: 4.5 },
] as const;

const READ = [
  'bg',
  'surface',
  'sidebar',
  'canvas',
  'text',
  'muted',
  'faint',
  'border',
  'accent',
  'danger',
  'hover',
  'selected',
  'tag-fill',
  'hl-blue',
  'hl-green',
  'hl-pink',
  'hl-purple',
  'code-keyword',
  'code-string',
  'code-number',
  'code-comment',
  'code-function',
  'code-type',
  'cal-fill-info',
  'cal-fill-tip',
  'cal-fill-success',
  'cal-fill-warning',
  'cal-fill-danger',
  'cal-edge-info',
  'cal-edge-tip',
  'cal-edge-success',
  'cal-edge-warning',
  'cal-edge-danger',
  'table-stripe',
  'table-header',
];

test.describe('contrast', () => {
  test('reads a roster with themes in it', () => {
    // Guards the guard: a roster regex matching nothing would make every test
    // below vacuously absent rather than failing.
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(2);
  });

  for (const id of THEME_IDS) {
    test(`${id} clears its contrast floors`, async ({ page }) => {
      await page.goto('/');

      // Waits for the shell: `goto` resolves on the document, not on React,
      // and under load the read below would otherwise run against a bare
      // `<div id="root">`.
      await expect(page.locator('section[aria-label]')).toHaveCount(3);

      // `readThemeTokens` PAINTS each token onto a probe element rather than
      // reading the custom property back. That is not a refactor for tidiness:
      // a custom property's value is substituted lazily, so reading
      // `--bear-muted` on a derived theme returns the literal string
      // `color-mix(in oklab, #e8e8f5 68%, #202030)`, not a colour. Fed to
      // `parseColour` that throws or yields NaN — and `NaN < min` is false, so
      // every derived theme would have reported a clean pass. Painting forces
      // the cascade to resolve it.
      const tokens = await readThemeTokens(page, id, READ);

      for (const name of READ) {
        expect(tokens[name], `--bear-${name} resolved to nothing in ${id}`).toBeTruthy();
      }

      // Collected rather than asserted one at a time: a theme with four bad
      // pairs should report four, not hide three behind the first failure.
      const failures: string[] = [];

      for (const rule of [...RULES, ...DECORATIVE]) {
        for (const ground of rule.grounds) {
          const ratio = contrastRatio(parseColour(tokens[rule.fg]!), parseColour(tokens[ground]!));
          // A non-finite ratio (NaN, or +/-Infinity from a degenerate colour)
          // must fail, not silently pass: `NaN < min` and `Infinity < min`
          // are both false, which is the exact mechanism that hid nine
          // themes' real contrast failures behind a `parseColour` blind
          // spot. This check stands even if `parseColour` itself is ever
          // bypassed or a future format sneaks past its throw.
          if (!Number.isFinite(ratio)) {
            failures.push(`${rule.fg} on ${ground}: unparseable colour (ratio was ${ratio})`);
          } else if (ratio < rule.min) {
            failures.push(`${rule.fg} on ${ground}: ${ratio.toFixed(2)} < ${rule.min}`);
          }
        }
      }

      for (const rule of OVERLAYS) {
        const ground = composite(
          parseColour(tokens[rule.overlay]!),
          parseColour(tokens[rule.ground]!),
        );
        const ratio = contrastRatio(parseColour(tokens[rule.fg]!), ground);
        // Same non-finite guard as the loop above — an unparseable colour
        // must not be able to hide behind `NaN < min` being false.
        if (!Number.isFinite(ratio)) {
          failures.push(
            `${rule.fg} on ${rule.overlay} over ${rule.ground}: unparseable colour (ratio was ${ratio})`,
          );
        } else if (ratio < rule.min) {
          failures.push(
            `${rule.fg} on ${rule.overlay} over ${rule.ground}: ${ratio.toFixed(2)} < ${rule.min}`,
          );
        }
      }

      expect(failures, `${id}\n${failures.join('\n')}`).toEqual([]);
    });
  }
});

/**
 * The theme picker, which is the one surface where SIXTEEN palettes are on
 * screen at once and the rules above cannot help.
 *
 * Every rule in this file compares tokens WITHIN one theme. A theme card is
 * painted in its own theme and sits on a dialog painted in the app's, so the
 * pair that matters spans two palettes and no per-theme floor sees it.
 *
 * Until 2026-09-04 each card was a single element carrying `data-theme`, its
 * background and its border, so the line separating it from the panel resolved
 * in the CARD's theme. Measured across all 240 (app x card) pairs: 52 had the
 * card's fill within 1.10 of the panel, 34 had its border within 1.20, and 4
 * had both — an invisible card. A user hit `solarized-light` with the `paper`
 * card (fill 1.08, edge 1.20) and reported it.
 *
 * Pinning the dialog to one theme cannot fix that, and the reason is a fact
 * about the roster rather than a preference: it runs from `paper` (pure white)
 * to `high-contrast` (pure black), so no single panel colour contrasts with
 * every card. The frame has to come from the APP's palette, outside the card's
 * `data-theme` boundary — which is what these two assertions hold in place.
 */
test.describe('the theme picker frames every card in the app palette', () => {
  /*
   * 3.0 rather than 4.5. This is a boundary between two surfaces, not text on
   * a ground, so WCAG's non-text floor is the applicable one; `--bear-faint`
   * measured 3.33 at its worst across the roster when this was written, so the
   * floor has real room under it without being a rubber stamp.
   */
  const FLOOR = 3;

  for (const id of THEME_IDS) {
    test(`${id} separates every card from the dialog panel`, async ({ page }) => {
      // The paint-time mirror is how a user's choice reaches the app, so
      // driving it here exercises the same path rather than a test-only one.
      await page.addInitScript((theme: string) => {
        localStorage.setItem('bear-web:theme', theme);
      }, id);
      await page.goto('/');
      await expect(page.locator('section[aria-label]')).toHaveCount(3);

      await page.getByRole('button', { name: /Change theme|테마/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const measured = await dialog.evaluate((panel) => {
        const radios = [...panel.querySelectorAll('[role="radio"]')];
        return {
          panel: getComputedStyle(panel).backgroundColor,
          frames: radios.map((radio) => getComputedStyle(radio).borderTopColor),
          themed: radios.filter((radio) => radio.hasAttribute('data-theme')).length,
          previews: radios.filter((radio) => radio.querySelector('[data-theme]') !== null).length,
          count: radios.length,
        };
      });

      expect(measured.count, 'no theme cards found').toBeGreaterThan(2);

      /*
       * The structural half, and the one that actually prevents regression.
       * Frames drawn from the app palette take exactly TWO values across the
       * grid — `--bear-faint` at rest and `--bear-accent` on the selected
       * card. The moment `data-theme` moves back onto the radio, each frame
       * resolves in its own theme and this becomes a dozen distinct values.
       * That fails even for a pair that happens to contrast, which no ratio
       * check can claim.
       *
       * Written as "at most two" rather than "exactly one" after the first
       * version asserted one and failed on the selected card — the test was
       * wrong there, not the component.
       */
      expect(measured.themed, 'a radio carries data-theme itself').toBe(0);
      const frames = [...new Set(measured.frames)];
      expect(frames.length, 'card frames resolve in more than the app palette').toBeLessThanOrEqual(
        2,
      );
      // System paints nothing on purpose; every other card has a preview.
      expect(measured.previews).toBe(measured.count - 1);

      // Both states, because the selected card is exactly the one a user is
      // looking at when they judge whether the picker is legible.
      const failures = frames
        .map((frame) => ({
          frame,
          ratio: contrastRatio(parseColour(frame), parseColour(measured.panel)),
        }))
        .filter(({ ratio }) => !(Number.isFinite(ratio) && ratio >= FLOOR));

      expect(
        failures.map((f) => `${f.frame} against the panel is ${f.ratio.toFixed(2)}`).join('; '),
      ).toBe('');
    });
  }
});
