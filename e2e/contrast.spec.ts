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
const DECORATIVE = [{ fg: 'border', grounds: ['bg', 'surface', 'sidebar'], min: 1.05 }] as const;

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
