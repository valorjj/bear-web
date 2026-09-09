import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { parseColour } from '../scripts/contrast.ts';
import { readThemeTokens } from './fixtures/tokens.ts';

/**
 * The five themes that shipped before F must render byte-identically after it.
 *
 * F derives DEFAULTS for new themes and deliberately does not re-derive these,
 * because measurement disproved that it could: `muted`, `faint` and `border`
 * look like `text` mixed toward `bg` — their lightness fits a constant ratio
 * in both sRGB and oklab — but their chroma does not. `indigo-dark`'s `muted`
 * is `(169, 163, 189)`, visibly violet, where the fitted mix gives a near-grey
 * `(165, 162, 173)`. No single ratio reproduces all four themes; the best fit
 * is off by up to 17/255 per channel. See
 * `docs/superpowers/specs/2026-08-24-f-theme-system-design.md`.
 *
 * So "a colour drifted slightly" is a demonstrated risk rather than a
 * hypothetical, and it is invisible to every other test in the suite: the
 * contrast harness only checks floors, and a drifted-but-still-legible colour
 * clears them.
 *
 * **`tag-fill` and `tag-fill-strong` were deliberately re-based on
 * 2026-09-07, for all five themes.** They were tints of `--bear-accent`; the
 * tag pill was restyled to read as an object in the prose rather than as
 * emphasis on it, so they are now tints of `--bear-text` (and a neutral
 * opaque pair in High Contrast, which uses opaque fills throughout). That is
 * a change of intent, not the drift this file exists to catch — every other
 * token in the baseline is untouched, which is exactly what made the two
 * distinguishable here.
 *
 * **The sidebar was deliberately re-based on 2026-09-09, for the two indigo
 * themes only — and re-based TWICE that day, the first attempt being wrong.**
 * It had been equal to `--bear-canvas` in both, so it dissolved into the
 * ground and read as undifferentiated from the other panes. The first attempt
 * stepped it LIGHTER (`#efecf9` / `#1e1a2a`) because that direction clears
 * the contrast floors for free — and it was a mistake: measured against the
 * note-list card, the sidebar went from 1.167 to 1.065, i.e. MORE similar to
 * the pane it was supposed to distinguish itself from. The original already
 * had the right relationship (sidebar darker than the floating cards); it was
 * only too weak to read.
 *
 * So the shipped values push that relationship harder instead: `#dcd6ef`
 * against the `#f5f4fa` card in Indigo Light (1.288) and `#0c0a11` against
 * `#252131` in Indigo Dark (1.256). Going deeper in a LIGHT theme costs two
 * further overrides, which is why the first attempt avoided it: `faint`
 * `#837e99` → `#7b7690` (the derived value measures 2.76 on the new sidebar,
 * under a 3.0 floor) and `border` `#e0dcec` → `#d2cddc` (1.05 exactly, which
 * is the floor itself and therefore fails). `muted` is what caps how deep the
 * sidebar can go: at `#d9d1eb` it falls to 4.37 under a 4.5 floor, so
 * `#dcd6ef` is the darkest value that needs no third override.
 *
 * Three tokens moved in Indigo Light and one in Indigo Dark, all deliberately
 * — unlike the `tag-fill` re-base above, this one cannot lean on "only one
 * token moved" as its evidence of intent. What distinguishes it from drift is
 * that every value is derived from a stated floor and recorded with its
 * measurement, and that `paper`, `ink` and `high-contrast` are untouched.
 * See `docs/rulings/design-tokens-and-layout.md`.
 *
 * Comparison is by parsed RGBA, never by string. A value that reads `rgb(…)`
 * today may legitimately read `color(srgb …)` afterwards while denoting the
 * same colour — which is exactly why `parseColour` had to learn that format
 * first.
 */
const BASELINE = JSON.parse(
  readFileSync(new URL('./fixtures/themeBaseline.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string>>;

/** The five themes as they stood before F. Not read from the roster: the
 *  roster grows to sixteen during F, and this file's whole job is to pin the
 *  five that existed before it. */
const SHIPPED = ['paper', 'indigo-light', 'indigo-dark', 'ink', 'high-contrast'] as const;

const TOKENS = [
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
  'focus',
  'hover',
  'selected',
  'shadow',
  'tag-fill',
  'tag-fill-strong',
  'hl-blue',
  'hl-green',
  'hl-pink',
  'hl-purple',
];

test('the baseline fixture covers every shipped theme and token', () => {
  // Guards the guard. A truncated or empty fixture would make every
  // assertion below vacuous — and the capture step runs against a live page,
  // so "the app had not mounted yet" is a real way to get one.
  expect(Object.keys(BASELINE).sort()).toEqual([...SHIPPED].sort());

  for (const [id, tokens] of Object.entries(BASELINE)) {
    expect(Object.keys(tokens).sort(), `${id} is missing tokens`).toEqual([...TOKENS].sort());
    for (const [name, value] of Object.entries(tokens)) {
      expect(value, `${id}'s --bear-${name} was captured empty`).toBeTruthy();
    }
  }
});

for (const id of SHIPPED) {
  test(`${id} renders exactly as it did before F`, async ({ page }) => {
    await page.goto('/');
    // Waits for the shell before reading computed styles. `goto` resolves on
    // the document, not on React; under load the evaluate below would
    // otherwise run against a bare `<div id="root">`.
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    const actual = await readThemeTokens(page, id, TOKENS);

    // Collected rather than asserted one at a time: a theme whose derivation
    // drifted four tokens should report four, not hide three behind the first.
    const drifted: string[] = [];

    for (const name of TOKENS) {
      const now = actual[name];
      const before = BASELINE[id]?.[name];

      expect(now, `--bear-${name} resolved to nothing in ${id}`).toBeTruthy();

      // Both sides come through `readThemeTokens`, so both are resolved
      // colours in the same notation and an exact match is the common case.
      if (now === before) continue;

      const a = parseColour(now!);
      const b = parseColour(before!);
      const delta = Math.max(
        Math.abs(a.r - b.r),
        Math.abs(a.g - b.g),
        Math.abs(a.b - b.b),
        Math.abs(a.a - b.a) * 255,
      );

      // One 8-bit step. Tighter would fail on rounding between notations;
      // looser would let a real drift through, and the measured near-miss
      // this test exists to catch was 17.
      if (delta > 1) {
        drifted.push(`--bear-${name}: ${before} -> ${now} (Δ${delta.toFixed(1)})`);
      }
    }

    expect(drifted, `${id} drifted:\n${drifted.join('\n')}`).toEqual([]);
  });
}
