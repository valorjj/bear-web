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
 * themes, after two wrong attempts that day.** It had equalled
 * `--bear-canvas` in both, so it dissolved into the ground. The first attempt
 * stepped it LIGHTER because that direction clears every floor for free, and
 * it was worse than useless: against the note-list card the sidebar went from
 * 1.167 to 1.065, i.e. MORE similar to the pane it was meant to distinguish
 * itself from. The second pushed it deeper to `#dcd6ef` (1.288) and was still
 * far too timid to read as the "huge contrast" that was asked for.
 *
 * What ships is a DARK panel: `#241f3d` — the theme's own `--bear-text`, so it
 * stays on palette — measuring **14.35** against the white card. Its contents
 * are made readable by tokens re-mapped on the sidebar's own container
 * (`.bear-sidebar-scope` in `tokens.css`), NOT by further theme-level
 * changes, which is why only ONE token moved here: `sidebar` itself. The
 * `faint` and `border` edits the second attempt needed were reverted with it,
 * because a dark panel with its own scoped tokens has no use for them.
 *
 * So this re-base can lean on the same evidence of intent the `tag-fill` one
 * above does — a single token moved per theme, `paper`, `ink` and
 * `high-contrast` untouched — and `e2e/contrast.spec.ts` checks the scoped
 * pairs through a probe mounted inside that scope. See
 * `docs/rulings/design-tokens-and-layout.md`.
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
