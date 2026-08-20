# M9a Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two hardcoded palettes with a five-theme system a user can pick from, and apply a stated spacing and type scale to every surface, so the app reads as deliberate rather than drifting.

**Architecture:** Tokens split into three tiers — palette and surface treatment belong to a theme, spacing and type do not. Themes ship as CSS blocks keyed `:root[data-theme='<id>']`, with a TS roster supplying the picker's metadata. No JavaScript ever applies a colour; the runtime sets one attribute. Contrast is verified in Chromium, which composites the alpha overlays jsdom cannot.

**Tech Stack:** React 19, Tailwind v4 (`@theme inline` maps `--bear-*` to utilities), Dexie/IndexedDB, Vitest + jsdom, Playwright, oxlint, TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-08-19-m9a-visual-system-design.md` — read it first; this plan argues from it.

## Global Constraints

- **All six gates pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` fails `npm test`.
- **No user-facing string is hardcoded.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is `Record<TranslationKey, string>`, so a missing Korean string is a compile error. Never weaken that annotation.
- **`src/ui/` imports nothing from `src/app/`, `src/data/`, or `src/i18n/`.** Enforced by `scripts/sourceLint.test.ts`.
- **`lucide-react` is imported only by `src/ui/Icon.tsx`.** Enforced.
- **Every icon is `aria-hidden`; every icon-only control carries an `aria-label` from `useT`.**
- **Source-scanning tests live in `scripts/`, not `src/`** — `tsconfig.app.json` omits Node types.
- **Only one `npm run test:e2e` at a time.** `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`; two concurrent runs measure each other's build.
- **A role-based or geometry test that fails during this restyle is a behaviour report, not a stale expectation.** Do not edit it to match new output without saying why. The one licensed exception is `e2e/smoke.spec.ts`'s pinned palette in Task 11.
- **Token ids, verbatim.** Palette tier (16): `bg` `surface` `sidebar` `canvas` `text` `muted` `faint` `border` `accent` `danger` `focus` `hover` `selected` `shadow` `tag-fill` `tag-fill-strong`. Surface tier (6): `radius-sm` `radius-md` `radius-lg` `shadow-popover` `shadow-dialog` `border-width`. All 22 prefixed `--bear-`.
- **Theme ids, verbatim:** `indigo-light`, `indigo-dark`, `paper`, `ink`, `high-contrast`.
- **Permitted spacing steps (px): 2, 4, 8, 12, 16, 24, 32, 48** — Tailwind `0.5 1 2 3 4 6 8 12`.

---

## File Structure

**Created**

| Path | Responsibility |
| --- | --- |
| `src/styles/themes.ts` | The theme roster: `id`, `labelKey`, `group`. No colours. |
| `src/app/theme.ts` | Pure helpers: storage key, mirror read/write, attribute application. No React. |
| `src/app/useTheme.ts` | React hook binding the settings table to the attribute and the mirror. |
| `src/ui/Popover.tsx` | Non-modal anchored surface with a standard focus trap. Presentation only. |
| `src/features/appearance/ThemePicker.tsx` | The grouped theme list. Consumes `useTheme`. |
| `src/features/appearance/index.ts` | Barrel. |
| `e2e/contrast.spec.ts` | The contrast harness. Gates every palette in the roster. |
| `scripts/contrast.ts` | Pure colour maths — parse, composite, ratio. Imported by the harness and unit-tested. |
| `scripts/contrast.test.ts` | Unit tests for the maths, with known-good published ratios. |

**Modified**

| Path | Change |
| --- | --- |
| `src/styles/tokens.css` | Restructured into named theme blocks; tier-2 tokens move into each. |
| `src/styles/index.css` | `@theme inline` gains `--color-tag-fill`, `--color-tag-fill-strong`; border width wiring. |
| `index.html` | Inline pre-paint script reading the mirror. |
| `scripts/sourceLint.test.ts` | Theme-token assertions replaced; spacing-scale assertion added. |
| `src/app/AppShell.tsx` | Sidebar footer hosting the picker. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | Theme names and picker copy. |
| `e2e/appearance.spec.ts` | Theme switching, persistence, no-flash. |
| `e2e/smoke.spec.ts` | Pinned palette updated to the new default (Task 11 only). |
| `e2e/shots.spec.ts`, `e2e/measure.spec.ts` | Iterate the roster. |
| `docs/design/DESIGN-bear-web.md` | Spacing ruling revised; measured ratios recorded. |
| `CLAUDE.md` | Status table, rulings, toolchain notes. |

---

## Task 1: The token contract

Restructure `tokens.css` into named theme blocks and move the surface tier into each theme. **Paper stays the default — this task must produce no visual change**, which is what makes it independently reviewable.

**Files:**
- Create: `src/styles/themes.ts`
- Modify: `src/styles/tokens.css`, `src/styles/index.css`, `scripts/sourceLint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `THEMES: readonly Theme[]`, `type ThemeId = 'indigo-light' | 'indigo-dark' | 'paper' | 'ink' | 'high-contrast'`, `DEFAULT_THEME_ID: ThemeId`, `interface Theme { id: ThemeId; labelKey: TranslationKey; group: 'light' | 'dark' }`.

- [ ] **Step 1: Write the failing test**

Replace the whole `describe('theme tokens', …)` block in `scripts/sourceLint.test.ts` with this. Keep the existing `blockTokens` helper and the `prefers-reduced-motion` test unchanged.

```ts
describe('theme tokens', () => {
  const css = readFileSync(TOKENS, 'utf8');

  const PALETTE = [
    'bg', 'surface', 'sidebar', 'canvas', 'text', 'muted', 'faint', 'border',
    'accent', 'danger', 'focus', 'hover', 'selected', 'shadow',
    'tag-fill', 'tag-fill-strong',
  ];
  const SURFACE = [
    'radius-sm', 'radius-md', 'radius-lg',
    'shadow-popover', 'shadow-dialog', 'border-width',
  ];
  const REQUIRED = [...PALETTE, ...SURFACE];

  // Read from the roster rather than restated here: two lists that must agree
  // is the defect this whole describe block exists to prevent.
  const roster = readFileSync('src/styles/themes.ts', 'utf8');
  const ids = [...roster.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]);

  it('lists five themes in the roster', () => {
    expect(ids).toHaveLength(5);
  });

  it('gives every theme in the roster a CSS block defining all 22 tokens', () => {
    for (const id of ids) {
      const block = blockTokens(css, `:root[data-theme='${id}']`);
      for (const token of REQUIRED) {
        expect(block.has(`--bear-${token}`), `--bear-${token} missing from ${id}`).toBe(true);
      }
    }
  });

  it('has no CSS theme block that is absent from the roster', () => {
    const declared = [...css.matchAll(/:root\[data-theme='([a-z-]+)'\]/g)].map((m) => m[1]);
    for (const id of new Set(declared)) {
      expect(ids, `${id} has a CSS block but no roster entry`).toContain(id);
    }
  });

  // `:root` and the default theme's own block must not drift apart: a user on
  // System and a user who explicitly picked the default must see one app.
  it('keeps :root identical to the default theme block', () => {
    const fallback = blockTokens(css, ':root {');
    const [defaultId] = roster.match(/DEFAULT_THEME_ID: ThemeId = '([a-z-]+)'/)!.slice(1);
    const explicit = blockTokens(css, `:root[data-theme='${defaultId}']`);
    for (const token of REQUIRED) {
      expect(fallback.get(`--bear-${token}`), `${token} drifted from ${defaultId}`)
        .toBe(explicit.get(`--bear-${token}`));
    }
  });

  // The M2-era hazard, generalised: a token right for someone who picked dark
  // and wrong for someone whose OS is dark. Nothing else in the suite sees it.
  it('keeps the system-dark block identical to its named theme', () => {
    const system = blockTokens(css, ':root:not([data-theme])');
    const [darkId] = roster.match(/SYSTEM_DARK_ID: ThemeId = '([a-z-]+)'/)!.slice(1);
    const named = blockTokens(css, `:root[data-theme='${darkId}']`);
    expect([...system.keys()].sort()).toEqual([...named.keys()].sort());
    for (const [token, value] of named) {
      expect(system.get(token), `${token} differs between the dark blocks`).toBe(value);
    }
  });

  // The guard must reject ANY explicit theme, not only one named 'light'.
  // With named themes the old selector let every light theme lose to a dark OS.
  it('guards the system-dark block on the attribute, not on a theme name', () => {
    expect(css).toContain(":root:not([data-theme])");
    expect(css).not.toContain(":root:not([data-theme='light'])");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: FAIL — `src/styles/themes.ts` does not exist (`ENOENT`).

- [ ] **Step 3: Write the roster**

Create `src/styles/themes.ts`:

```ts
import type { TranslationKey } from '@/i18n/en';

export type ThemeId = 'indigo-light' | 'indigo-dark' | 'paper' | 'ink' | 'high-contrast';

export interface Theme {
  id: ThemeId;
  labelKey: TranslationKey;
  /**
   * Which heading the picker files this theme under. It is NOT derived from
   * the palette: `high-contrast` is a dark theme by intent, and deriving the
   * group from luminance would make the picker's grouping a side effect of a
   * colour edit.
   */
  group: 'light' | 'dark';
}

export const THEMES: readonly Theme[] = [
  { id: 'indigo-light', labelKey: 'theme.indigoLight', group: 'light' },
  { id: 'paper', labelKey: 'theme.paper', group: 'light' },
  { id: 'indigo-dark', labelKey: 'theme.indigoDark', group: 'dark' },
  { id: 'ink', labelKey: 'theme.ink', group: 'dark' },
  { id: 'high-contrast', labelKey: 'theme.highContrast', group: 'dark' },
];

/** Applied by `:root`, i.e. what a visitor with no stored choice sees. */
export const DEFAULT_THEME_ID: ThemeId = 'paper';

/** Applied by the `prefers-color-scheme: dark` block when no theme is chosen. */
export const SYSTEM_DARK_ID: ThemeId = 'ink';
```

Add the five keys to `src/i18n/en.ts` and `src/i18n/ko.ts`:

```ts
// en.ts
'theme.indigoLight': 'Indigo Light',
'theme.indigoDark': 'Indigo Dark',
'theme.paper': 'Paper',
'theme.ink': 'Ink',
'theme.highContrast': 'High Contrast',
```

```ts
// ko.ts
'theme.indigoLight': '인디고 라이트',
'theme.indigoDark': '인디고 다크',
'theme.paper': '페이퍼',
'theme.ink': '잉크',
'theme.highContrast': '고대비',
```

- [ ] **Step 4: Restructure `tokens.css`**

Shape — keep every existing comment, they are load-bearing rulings:

```css
/*
 * `:root` carries BOTH the tier-3 globals and the default theme's 22 tokens.
 * The default palette is therefore stated twice — here and in its own named
 * block — and `sourceLint` asserts the two agree. That duplication is
 * deliberate: see the note below on why a grouped selector cannot be used.
 */
:root {
  /* Tier 3: global, not themeable. Density is a property of the app. */
  --bear-font-sans: 'Pretendard Variable', system-ui, sans-serif;
  --bear-font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;
  /* …all --bear-text-ui-*, --bear-leading-ui, durations, ease,
     --bear-font-size, --bear-line-height, --bear-line-width,
     --bear-para-spacing, --bear-para-indent — unchanged… */

  /* The default theme's 16 palette + 6 surface tokens, today's Paper values. */
}

:root[data-theme='paper'] { /* the same 22, identical to the block above */ }

:root[data-theme='ink'] { /* today's Ink values + the same surface tier */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* byte-identical to the ink block */ }
}
```

**Do not write this as a grouped selector** (`:root, :root[data-theme='paper'] { … }`), however tempting. `blockTokens` locates a block by `indexOf(selector)` and then takes the next `{`, so a lookup for `':root {'` would fail to match the grouped form — and, worse, would silently match nothing in a file that still has a plain `:root {` block elsewhere. Two flat blocks plus the equality assertion is the shape the helper can actually read.

`--bear-border-width: 1px` is new to every block. Radii and the two shadows move **out** of the global section and **into** each theme.

- [ ] **Step 5: Wire the new tokens into Tailwind**

In `src/styles/index.css`, inside `@theme inline`, add below `--color-canvas`:

```css
  --color-tag-fill: var(--bear-tag-fill);
  --color-tag-fill-strong: var(--bear-tag-fill-strong);
```

**This matters more than it looks.** Tailwind v4 emits nothing for a utility whose theme key is absent — no warning, no error. `--color-hover` was missing for two milestones and `hover:bg-hover` silently did nothing. Verify by grepping the built CSS, not the source:

```bash
npm run build && grep -c 'tag-fill' dist/assets/*.css
```

Expected: a non-zero count.

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass. `npm run test:e2e` must also pass **unchanged** — this task alters no rendered value.

- [ ] **Step 7: Prove it visually**

Run: `npm run measure` and diff `docs/design/measurements.md`.
Expected: **no diff.** A diff here means the restructure moved something; find it before committing.

- [ ] **Step 8: Commit**

```bash
git add src/styles/themes.ts src/styles/tokens.css src/styles/index.css scripts/sourceLint.test.ts src/i18n/en.ts src/i18n/ko.ts
git commit -m "refactor(tokens): name the themes and give each one its own surface tier"
```

---

## Task 2: The contrast harness

Build the gate **before** the palettes it gates. Paper and Ink are its calibration case: their ratios are already recorded by hand in `DESIGN-bear-web.md`, so the harness must reproduce those numbers before its verdict on a new theme means anything.

**Files:**
- Create: `scripts/contrast.ts`, `scripts/contrast.test.ts`, `e2e/contrast.spec.ts`

**Interfaces:**
- Consumes: `THEMES` from Task 1.
- Produces: `parseColour(css: string): Rgba`, `composite(fg: Rgba, bg: Rgba): Rgba`, `contrastRatio(a: Rgba, b: Rgba): number`, `interface Rgba { r: number; g: number; b: number; a: number }`.

- [ ] **Step 1: Write the failing unit test**

Create `scripts/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { composite, contrastRatio, parseColour } from './contrast';

describe('parseColour', () => {
  it('reads six-digit hex', () => {
    expect(parseColour('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('reads three-digit hex', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('reads the space-separated rgb() form the tokens are written in', () => {
    expect(parseColour('rgb(28 27 25 / 0.05)')).toEqual({ r: 28, g: 27, b: 25, a: 0.05 });
  });

  it('reads the comma form a browser returns from getComputedStyle', () => {
    expect(parseColour('rgba(28, 27, 25, 0.05)')).toEqual({ r: 28, g: 27, b: 25, a: 0.05 });
  });
});

describe('contrastRatio', () => {
  // Published values. Black on white is exactly 21:1 by definition; the
  // mid-grey case is the one that catches a linearisation mistake, which a
  // black/white-only test cannot see.
  it('scores black on white at 21:1', () => {
    expect(contrastRatio(parseColour('#000'), parseColour('#fff'))).toBeCloseTo(21, 2);
  });

  it('scores a colour against itself at 1:1', () => {
    expect(contrastRatio(parseColour('#777'), parseColour('#777'))).toBeCloseTo(1, 5);
  });

  it('linearises rather than averaging channels', () => {
    expect(contrastRatio(parseColour('#808080'), parseColour('#ffffff'))).toBeCloseTo(3.95, 1);
  });

  it('is symmetric', () => {
    const a = parseColour('#123456');
    const b = parseColour('#abcdef');
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe('composite', () => {
  it('returns the ground when the overlay is fully transparent', () => {
    const ground = parseColour('#ffffff');
    expect(composite(parseColour('rgb(0 0 0 / 0)'), ground)).toEqual(ground);
  });

  it('returns the overlay when it is opaque', () => {
    expect(composite(parseColour('#000000'), parseColour('#ffffff')))
      .toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('blends by alpha', () => {
    expect(composite(parseColour('rgb(0 0 0 / 0.5)'), parseColour('#ffffff')))
      .toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/contrast.test.ts`
Expected: FAIL — cannot resolve `./contrast`.

- [ ] **Step 3: Implement the maths**

Create `scripts/contrast.ts`:

```ts
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Accepts hex, and both `rgb()` spellings: the space-slash form the tokens are
 * authored in, and the comma form `getComputedStyle` returns. The harness sees
 * both — authored values from the stylesheet and resolved values from the
 * browser — so a parser that handled only one would pass its own tests and
 * fail on real input.
 */
export function parseColour(css: string): Rgba {
  const text = css.trim();

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const wide = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    return {
      r: parseInt(wide.slice(0, 2), 16),
      g: parseInt(wide.slice(2, 4), 16),
      b: parseInt(wide.slice(4, 6), 16),
      a: wide.length === 8 ? parseInt(wide.slice(6, 8), 16) / 255 : 1,
    };
  }

  const parts = text
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);

  const [r, g, b, a] = parts;
  return { r, g, b, a: a === undefined ? 1 : a };
}

/** Source-over compositing. The result is always opaque. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  };
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run scripts/contrast.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the harness**

Create `e2e/contrast.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { composite, contrastRatio, parseColour } from '../scripts/contrast';
import { THEMES } from '../src/styles/themes';

/** Foreground token → the grounds it must be legible on → its floor. */
const RULES = [
  { fg: 'text', grounds: ['bg', 'surface', 'sidebar', 'canvas'], min: 4.5 },
  { fg: 'muted', grounds: ['bg', 'surface', 'sidebar', 'canvas'], min: 4.5 },
  { fg: 'faint', grounds: ['bg', 'surface', 'sidebar', 'canvas'], min: 3.0 },
  { fg: 'accent', grounds: ['bg', 'surface', 'sidebar'], min: 4.5 },
  { fg: 'danger', grounds: ['bg', 'surface', 'sidebar'], min: 4.5 },
  { fg: 'border', grounds: ['bg', 'surface', 'sidebar'], min: 3.0 },
] as const;

/** Overlays are alpha over a ground; text must survive the composite. */
const OVERLAYS = [
  { overlay: 'selected', ground: 'surface', fg: 'text', min: 4.5 },
  { overlay: 'hover', ground: 'surface', fg: 'text', min: 4.5 },
  { overlay: 'tag-fill', ground: 'bg', fg: 'accent', min: 3.0 },
] as const;

for (const theme of THEMES) {
  test(`${theme.id} clears its contrast floors`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((id) => {
      document.documentElement.setAttribute('data-theme', id);
    }, theme.id);

    // Resolved through the real cascade: `var()` is substituted and every
    // value comes back in the browser's own spelling. This is the step jsdom
    // cannot perform, and the reason these ratios were measured by hand until
    // now.
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(`--bear-${name}`).trim();
      return Object.fromEntries(
        ['bg', 'surface', 'sidebar', 'canvas', 'text', 'muted', 'faint',
         'border', 'accent', 'danger', 'hover', 'selected', 'tag-fill']
          .map((n) => [n, read(n)]),
      ) as Record<string, string>;
    });

    const failures: string[] = [];

    for (const rule of RULES) {
      for (const ground of rule.grounds) {
        const ratio = contrastRatio(parseColour(tokens[rule.fg]), parseColour(tokens[ground]));
        if (ratio < rule.min) {
          failures.push(`${rule.fg} on ${ground}: ${ratio.toFixed(2)} < ${rule.min}`);
        }
      }
    }

    for (const rule of OVERLAYS) {
      const ground = composite(parseColour(tokens[rule.overlay]), parseColour(tokens[rule.ground]));
      const ratio = contrastRatio(parseColour(tokens[rule.fg]), ground);
      if (ratio < rule.min) {
        failures.push(`${rule.fg} on ${rule.overlay} over ${rule.ground}: ${ratio.toFixed(2)} < ${rule.min}`);
      }
    }

    expect(failures, `${theme.id}\n${failures.join('\n')}`).toEqual([]);
  });
}
```

- [ ] **Step 6: Run it and read the result honestly**

Run: `npm run test:e2e -- contrast.spec.ts`

Expected at this point: **`paper` and `ink` pass; the other three fail because their blocks do not exist yet.** That is the correct state — the harness is written before the palettes.

Cross-check the two that pass against the hand-measured ratios in `DESIGN-bear-web.md` (`faint` on `sidebar`: Paper 3.21, Ink 3.40). **If the harness disagrees with the recorded numbers, the harness is wrong — fix it before continuing.** Its whole value is that it can be trusted about themes nobody has measured.

- [ ] **Step 7: Fault-inject to prove it can fail**

Temporarily set Paper's `--bear-faint` back to its pre-M7.5 value `#9c988f` (recorded at 2.51:1) and re-run.
Expected: FAIL naming `faint on sidebar`. Revert.

**A harness that has never failed is not evidence of anything.** This project has shipped three tests that could not fail.

- [ ] **Step 8: Commit**

```bash
git add scripts/contrast.ts scripts/contrast.test.ts e2e/contrast.spec.ts
git commit -m "test(contrast): verify token ratios in a real cascade, calibrated on Paper and Ink"
```

---

## Task 3: The indigo pair

**Files:**
- Modify: `src/styles/tokens.css`, `docs/design/DESIGN-bear-web.md`

**Interfaces:**
- Consumes: `THEMES`, the harness.
- Produces: `:root[data-theme='indigo-light']`, `:root[data-theme='indigo-dark']`. Still not default.

- [ ] **Step 1: Add both blocks**

Values from spec §3. **Provisional — the harness is authoritative.**

```css
:root[data-theme='indigo-light'] {
  --bear-canvas: #eceaf3;
  --bear-bg: #ffffff;
  --bear-surface: #ffffff;
  /* The sidebar deliberately equals the canvas: in Soft Depth it dissolves
     into the ground, and only panes holding content float. */
  --bear-sidebar: #eceaf3;
  --bear-text: #241f3d;
  --bear-muted: #6f6a87;
  --bear-faint: #9d99b0;
  --bear-border: #e4e1ee;
  --bear-accent: #5b4ad6;
  --bear-danger: #dc2626;
  --bear-focus: #5b4ad6;
  --bear-hover: rgb(40 34 66 / 0.05);
  --bear-selected: rgb(91 74 214 / 0.09);
  --bear-shadow: rgb(40 34 66 / 0.07);
  --bear-tag-fill: rgb(91 74 214 / 0.12);
  --bear-tag-fill-strong: rgb(91 74 214 / 0.26);

  --bear-radius-sm: 6px;
  --bear-radius-md: 8px;
  --bear-radius-lg: 12px;
  --bear-border-width: 1px;
  --bear-shadow-popover: 0 1px 2px rgb(40 34 66 / 0.05), 0 8px 24px rgb(40 34 66 / 0.07);
  --bear-shadow-dialog: 0 12px 40px rgb(40 34 66 / 0.18);
}

:root[data-theme='indigo-dark'] {
  --bear-canvas: #14121b;
  --bear-bg: #1e1b26;
  --bear-surface: #1e1b26;
  --bear-sidebar: #14121b;
  --bear-text: #f0edf7;
  --bear-muted: #a9a3bd;
  --bear-faint: #6f6a85;
  --bear-border: #2e2a3a;
  --bear-accent: #9b8cff;
  --bear-danger: #ff6b6b;
  --bear-focus: #9b8cff;
  --bear-hover: rgb(255 255 255 / 0.06);
  --bear-selected: rgb(155 140 255 / 0.20);
  --bear-shadow: rgb(0 0 0 / 0.40);
  --bear-tag-fill: rgb(155 140 255 / 0.22);
  --bear-tag-fill-strong: rgb(155 140 255 / 0.38);

  --bear-radius-sm: 6px;
  --bear-radius-md: 8px;
  --bear-radius-lg: 12px;
  --bear-border-width: 1px;
  --bear-shadow-popover: 0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px rgb(0 0 0 / 0.35);
  --bear-shadow-dialog: 0 12px 40px rgb(0 0 0 / 0.55);
}
```

- [ ] **Step 2: Run the harness**

Run: `npm run test:e2e -- contrast.spec.ts`

Expected: `indigo-light` **fails** on `faint on bg` — `#9d99b0` on white is ≈2.6:1 against a 3.0 floor. This is the harness doing its job on its first real palette.

- [ ] **Step 3: Fix the failures the harness names**

Darken `--bear-faint` until it clears 3.0 on **all four** grounds (start at `#8b8799` and iterate). Do the same for any other pair reported. Change only what fails; do not pre-emptively darken values that pass.

- [ ] **Step 4: Re-run until green**

Run: `npm run test:e2e -- contrast.spec.ts`
Expected: PASS for `indigo-light`, `indigo-dark`, `paper`, `ink`. `high-contrast` still fails — it does not exist yet.

- [ ] **Step 5: Record the measured ratios**

In `DESIGN-bear-web.md`, under the contrast section, add a table of every measured ratio for both indigo themes and note that they are now produced by `e2e/contrast.spec.ts` rather than by hand.

- [ ] **Step 6: Look at it**

```bash
npm run dev
```

Open the app, set `document.documentElement.dataset.theme = 'indigo-light'` in the console, then `'indigo-dark'`. Confirm both render and nothing is invisible. **Tests cannot see "renders wrong" — this step is not optional.**

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.css docs/design/DESIGN-bear-web.md
git commit -m "feat(themes): add the indigo pair, with ratios gated by the harness"
```

---

## Task 4: High Contrast, and making `border-width` real

High Contrast is the only theme that stresses the surface tier. It is also the only one that will expose every border in the app that ignores the token.

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/index.css`, and every component drawing a border.

- [ ] **Step 1: Add the block**

```css
:root[data-theme='high-contrast'] {
  --bear-canvas: #000000;
  --bear-bg: #000000;
  --bear-surface: #000000;
  --bear-sidebar: #000000;
  --bear-text: #ffffff;
  --bear-muted: #e6e6e6;
  --bear-faint: #c9c9c9;
  --bear-border: #ffffff;
  --bear-accent: #ffd400;
  --bear-danger: #ff6b6b;
  --bear-focus: #ffd400;
  /* Solid, not alpha. An overlay that composites is exactly the thing this
     theme exists to avoid. */
  --bear-hover: #2a2a2a;
  --bear-selected: #4a3d00;
  --bear-shadow: transparent;
  --bear-tag-fill: #4a3d00;
  --bear-tag-fill-strong: #6b5800;

  --bear-radius-sm: 2px;
  --bear-radius-md: 4px;
  --bear-radius-lg: 6px;
  --bear-border-width: 2px;
  /* With no elevation, a floating surface is separated by its border alone. */
  --bear-shadow-popover: none;
  --bear-shadow-dialog: none;
}
```

- [ ] **Step 2: Find every border that ignores the token**

```bash
grep -rn 'border\b\|border-t\|border-b\|border-l\|border-r' --include='*.tsx' --include='*.css' src | grep -v 'border-width' | grep -v 'rounded'
```

Every hit is a border whose width is hardcoded by Tailwind at 1px. In `index.css`, add a global rule so the token is consumed by default rather than at each call site:

```css
@layer base {
  * {
    border-width: 0;
    border-style: solid;
  }
}

@layer utilities {
  .border,
  .border-t,
  .border-b,
  .border-l,
  .border-r {
    border-width: var(--bear-border-width);
  }
}
```

Verify the compiled output, not the source:

```bash
npm run build && grep -c 'var(--bear-border-width)' dist/assets/*.css
```

Expected: non-zero. **Tailwind emits nothing silently for an absent key — the source proves nothing.**

- [ ] **Step 3: Run the harness**

Run: `npm run test:e2e -- contrast.spec.ts`
Expected: all five themes PASS.

- [ ] **Step 4: Look at it in the browser**

Set `data-theme='high-contrast'` and confirm: panes are separated by visible 2px borders, no surface relies on a shadow, and the popover-less state is still legible. This is the one theme where a missing border makes two surfaces merge into one black rectangle — and no test can see that.

- [ ] **Step 5: Full gate, then commit**

```bash
npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build
git add src/styles/tokens.css src/styles/index.css
git commit -m "feat(themes): add High Contrast, and make every border consume the width token"
```

---

## Task 5: Persistence without a flash

No UI yet. This task makes the choice durable and makes it survive first paint.

**Files:**
- Create: `src/app/theme.ts`, `src/app/theme.test.ts`, `src/app/useTheme.ts`, `src/app/useTheme.test.tsx`
- Modify: `index.html`, `scripts/sourceLint.test.ts`

**Interfaces:**
- Consumes: `THEMES`, `ThemeId`, `DEFAULT_THEME_ID` from Task 1; `settings` from `@/data`.
- Produces: `THEME_KEY = 'theme'`, `type ThemeChoice = ThemeId | 'system'`, `readMirror(): ThemeChoice`, `writeMirror(choice: ThemeChoice): void`, `applyTheme(choice: ThemeChoice): void`, `useTheme(): { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, readMirror, writeMirror } from './theme';

describe('the paint-time mirror', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('round-trips a choice', () => {
    writeMirror('indigo-dark');
    expect(readMirror()).toBe('indigo-dark');
  });

  it('falls back to system when nothing is stored', () => {
    expect(readMirror()).toBe('system');
  });

  // The mirror is written by a script that predates React and is read by one
  // that predates it too. A value that is not a known theme must not reach
  // `data-theme`, or a stale or hand-edited entry paints an unstyled app.
  it('falls back to system when the stored value is not a known theme', () => {
    localStorage.setItem('bear-web:theme', 'dracula');
    expect(readMirror()).toBe('system');
  });

  it('stamps the attribute for a named theme', () => {
    applyTheme('paper');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  });

  // System means the ABSENCE of the attribute, so the media query decides.
  // Writing `data-theme="system"` would match no block and paint the :root
  // fallback in a dark OS — the exact defect the selector change guards.
  it('removes the attribute for system', () => {
    applyTheme('ink');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Implement**

Create `src/app/theme.ts`:

```ts
import { THEMES, type ThemeId } from '@/styles/themes';

export type ThemeChoice = ThemeId | 'system';

/** The durable record's key in the settings table. */
export const THEME_KEY = 'theme';

/** The paint-time cache's key. Namespaced: localStorage is origin-wide. */
export const MIRROR_KEY = 'bear-web:theme';

function isChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || THEMES.some((t) => t.id === value);
}

export function readMirror(): ThemeChoice {
  try {
    const stored = localStorage.getItem(MIRROR_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Private-mode Safari and some embedded webviews throw on access rather
    // than returning null. A theme preference must never break boot.
    return 'system';
  }
}

export function writeMirror(choice: ThemeChoice): void {
  try {
    localStorage.setItem(MIRROR_KEY, choice);
  } catch {
    // Ignored: the settings table is the source of truth. Losing the mirror
    // costs a flash on the next launch, not the preference.
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/theme.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the pre-paint script**

In `index.html`, inside `<head>`, after `<title>`:

```html
    <!--
      Runs before first paint. IndexedDB is the durable source of truth for the
      theme, but it can only be read asynchronously and therefore cannot paint
      the first frame — without this mirror every launch renders the default
      and then corrects itself, worst in the dark themes.

      This reads and writes an ID, never a colour, so the "every colour comes
      from a custom property" rule holds. It is duplicated from
      `src/app/theme.ts` on purpose: a module import would be async and defeat
      the point. `scripts/sourceLint.test.ts` asserts the two agree.
    -->
    <script>
      (function () {
        try {
          var stored = localStorage.getItem('bear-web:theme');
          var known = ['indigo-light', 'indigo-dark', 'paper', 'ink', 'high-contrast'];
          if (stored && known.indexOf(stored) !== -1) {
            document.documentElement.setAttribute('data-theme', stored);
          }
        } catch (e) {
          /* storage unavailable; the media query decides */
        }
      })();
    </script>
```

- [ ] **Step 6: Assert the duplication cannot drift**

Add to `scripts/sourceLint.test.ts`:

```ts
describe('the pre-paint theme script', () => {
  const html = readFileSync('index.html', 'utf8');
  const roster = readFileSync('src/styles/themes.ts', 'utf8');
  const ids = [...roster.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]);

  // The script cannot import the roster — a module import is async and would
  // paint first. So the list is duplicated, and this is what stops it drifting:
  // a theme added to the roster but missing here silently loses its no-flash
  // behaviour, which nothing else in the suite can see.
  it('lists exactly the roster ids', () => {
    const listed = html.match(/var known = \[([^\]]+)\]/)![1];
    for (const id of ids) {
      expect(listed, `${id} missing from the pre-paint script`).toContain(`'${id}'`);
    }
    expect(listed.split(',')).toHaveLength(ids.length);
  });

  it('reads the same storage key the app writes', () => {
    const key = readFileSync('src/app/theme.ts', 'utf8').match(/MIRROR_KEY = '([^']+)'/)![1];
    expect(html).toContain(`localStorage.getItem('${key}')`);
  });
});
```

- [ ] **Step 7: Write the hook**

Create `src/app/useTheme.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';

import { settings } from '@/data';

import { applyTheme, readMirror, THEME_KEY, type ThemeChoice, writeMirror } from './theme';

export interface ThemeControl {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

/**
 * The settings table is the source of truth; the mirror is a paint-time cache.
 * On boot the stored value wins and the mirror is rewritten from it, so a
 * mirror edited by hand or left behind by an older build cannot outlive one
 * launch.
 *
 * Deps are the constant `[]`, so the documented previous-deps-for-one-tick
 * behaviour of `useLiveQuery` does not apply and the tag-and-verify pattern
 * would be dead complexity here.
 */
export function useTheme(): ThemeControl {
  const stored = useLiveQuery(
    () => settings.get<ThemeChoice>(THEME_KEY, readMirror()),
    [],
    readMirror(),
  );

  useEffect(() => {
    applyTheme(stored);
    writeMirror(stored);
  }, [stored]);

  return {
    choice: stored,
    setChoice: (choice) => {
      // Optimistic: the attribute and the mirror move now, the durable write
      // follows. Waiting on IndexedDB would leave the picker visibly lagging
      // its own click.
      applyTheme(choice);
      writeMirror(choice);
      void settings.set(THEME_KEY, choice);
    },
  };
}
```

- [ ] **Step 8: Test the hook**

Create `src/app/useTheme.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';

import { THEME_KEY } from './theme';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    await settings.remove(THEME_KEY);
  });

  it('defaults to system with nothing stored', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.choice).toBe('system'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies a chosen theme to the document', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('high-contrast'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('high-contrast');
  });

  it('persists the choice durably', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => result.current.setChoice('ink'));
    await waitFor(async () => {
      expect(await settings.get(THEME_KEY, 'system')).toBe('ink');
    });
  });

  // The settings table outranks the mirror. A mirror left behind by an older
  // build must not survive a launch.
  it('rewrites a mirror that disagrees with the stored value', async () => {
    localStorage.setItem('bear-web:theme', 'paper');
    await settings.set(THEME_KEY, 'indigo-dark');
    renderHook(() => useTheme());
    await waitFor(() => {
      expect(localStorage.getItem('bear-web:theme')).toBe('indigo-dark');
    });
  });
});
```

- [ ] **Step 9: Run everything, then commit**

```bash
npx vitest run src/app/theme.test.ts src/app/useTheme.test.tsx scripts/sourceLint.test.ts
npm test && npm run lint && npm run typecheck && npm run build
git add src/app/theme.ts src/app/theme.test.ts src/app/useTheme.ts src/app/useTheme.test.tsx index.html scripts/sourceLint.test.ts
git commit -m "feat(theme): persist the choice durably and stamp it before first paint"
```

---

## Task 6: The `Popover` primitive

**Files:**
- Create: `src/ui/Popover.tsx`
- Modify: `src/ui/ui.test.tsx`

**Interfaces:**
- Consumes: nothing from `src/app/`, `src/data/` or `src/i18n/` — this is `src/ui/`, and the boundary is enforced.
- Produces: `Popover({ open, onClose, label, children, className })`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/ui.test.tsx`:

```tsx
describe('Popover', () => {
  it('renders nothing when closed', () => {
    render(<Popover open={false} onClose={() => {}} label="Appearance"><button>x</button></Popover>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names itself for assistive tech', () => {
    render(<Popover open onClose={() => {}} label="Appearance"><button>x</button></Popover>);
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Popover open onClose={onClose} label="Appearance"><button>x</button></Popover>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus to the first focusable on open', async () => {
    render(
      <Popover open onClose={() => {}} label="Appearance">
        <button>first</button>
        <button>second</button>
      </Popover>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));
  });

  // ConfirmDialog's trap queries 'button' specifically — a documented gap that
  // skips a link or an input rather than holding it at the edge. This surface
  // contains grouped rows and headings, so it uses a standard selector from
  // the start rather than inheriting that gap.
  it('traps Tab across every focusable kind, not only buttons', async () => {
    render(
      <Popover open onClose={() => {}} label="Appearance">
        <button>first</button>
        <a href="#x">link</a>
        <input aria-label="field" />
      </Popover>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('link'));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: FAIL — `Popover` is not exported.

- [ ] **Step 3: Implement**

Create `src/ui/Popover.tsx`:

```tsx
import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A standard focusable selector, deliberately wider than `ConfirmDialog`'s
 * `'button'`. That narrowness is a documented gap there and would be a live
 * defect here.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({
  open,
  onClose,
  label,
  children,
  className = '',
}: PopoverProps): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`bg-surface border-border shadow-popover rounded-lg border p-2 ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Popover.tsx src/ui/ui.test.tsx
git commit -m "feat(ui): add a Popover primitive with a standard focus trap"
```

---

## Task 7: The picker

**Files:**
- Create: `src/features/appearance/ThemePicker.tsx`, `src/features/appearance/ThemePicker.test.tsx`, `src/features/appearance/index.ts`
- Modify: `src/app/AppShell.tsx`, `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `useTheme` (Task 5), `Popover` (Task 6), `THEMES` (Task 1).
- Produces: `<ThemePicker />`, self-contained including its trigger button.

- [ ] **Step 1: Add the copy**

`en.ts`:

```ts
'appearance.label': 'Appearance',
'appearance.open': 'Change theme',
'appearance.system': 'System',
'appearance.group.light': 'Light',
'appearance.group.dark': 'Dark',
```

`ko.ts`:

```ts
'appearance.label': '모양',
'appearance.open': '테마 변경',
'appearance.system': '시스템',
'appearance.group.light': '밝은 테마',
'appearance.group.dark': '어두운 테마',
```

- [ ] **Step 2: Write the failing test**

Create `src/features/appearance/ThemePicker.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@/i18n';

import { ThemePicker } from './ThemePicker';

function setup() {
  return render(
    <I18nProvider>
      <ThemePicker />
    </I18nProvider>,
  );
}

describe('ThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('labels its icon-only trigger', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change theme' })).toBeTruthy();
  });

  it('opens a grouped list of every theme plus System', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    expect(screen.getByRole('group', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Dark' })).toBeTruthy();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
  });

  it('files High Contrast under Dark', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    const dark = screen.getByRole('group', { name: 'Dark' });
    expect(dark.textContent).toContain('High Contrast');
  });

  it('applies the chosen theme to the document', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Indigo Dark' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('indigo-dark'),
    );
  });

  it('marks the active theme as checked', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paper' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    expect(screen.getByRole('menuitemradio', { name: 'Paper' }).getAttribute('aria-checked')).toBe('true');
  });

  // System is the ABSENCE of the attribute. A picker that wrote
  // data-theme="system" would match no block and paint :root in a dark OS.
  it('removes the attribute when System is chosen', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ink' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }));
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false),
    );
  });

  it('closes after a choice', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paper' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/features/appearance/ThemePicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/features/appearance/ThemePicker.tsx`:

```tsx
import { type ReactElement, useState } from 'react';

import { useTheme } from '@/app/useTheme';
import { useT } from '@/i18n';
import { THEMES } from '@/styles/themes';
import { Icon, Palette } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import type { ThemeChoice } from '@/app/theme';

const GROUPS = [
  { group: 'light', labelKey: 'appearance.group.light' },
  { group: 'dark', labelKey: 'appearance.group.dark' },
] as const;

export function ThemePicker(): ReactElement {
  const t = useT();
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);

  function pick(next: ThemeChoice): void {
    setChoice(next);
    setOpen(false);
  }

  function row(value: ThemeChoice, label: string): ReactElement {
    return (
      <button
        key={value}
        type="button"
        role="menuitemradio"
        aria-checked={choice === value}
        onClick={() => pick(value)}
        className="text-ui text-text hover:bg-hover flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear aria-checked:bg-selected"
      >
        <span
          aria-hidden="true"
          data-theme={value === 'system' ? undefined : value}
          className="border-border bg-canvas size-4 shrink-0 rounded-sm border"
        >
          <span className="bg-accent m-0.5 block size-2 rounded-sm" />
        </span>
        {label}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('appearance.open')}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:bg-hover hover:text-text flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)] ease-bear"
      >
        <Icon glyph={Palette} size="md" />
      </button>

      {open ? (
        <Popover
          open
          onClose={() => setOpen(false)}
          label={t('appearance.label')}
          className="absolute bottom-full left-0 z-10 mb-2 w-48"
        >
          {row('system', t('appearance.system'))}
          {GROUPS.map(({ group, labelKey }) => (
            <div key={group} role="group" aria-label={t(labelKey)}>
              <p className="text-ui-xs text-faint px-2 pt-2 pb-0.5">{t(labelKey)}</p>
              {THEMES.filter((theme) => theme.group === group).map((theme) =>
                row(theme.id, t(theme.labelKey)),
              )}
            </div>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
```

The swatch carries `data-theme` on itself, so **each row previews its own theme through the same cascade the app uses** — no colour is duplicated in TS, and a palette edit updates the picker for free.

Export `Palette` from `src/ui/Icon.tsx` alongside the existing glyphs. `lucide-react` must not be imported anywhere else.

Create `src/features/appearance/index.ts`:

```ts
export { ThemePicker } from './ThemePicker';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/appearance/ThemePicker.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Mount it in the sidebar footer**

In `AppShell.tsx`, the sidebar `Pane` currently wraps `SmartListSidebar` and `TagSidebar`. Make its child a column: the scrolling list, then a footer that does not scroll with it.

```tsx
<Pane label={t('pane.sidebar')} width={widths.sidebarWidth} className="bg-sidebar flex flex-col">
  <div className="min-h-0 flex-1 overflow-y-auto">
    {/* SmartListSidebar and TagSidebar, unchanged */}
  </div>
  <div className="border-border flex shrink-0 items-center border-t p-2">
    <ThemePicker />
  </div>
</Pane>
```

`Pane` sets `overflow-y-auto` on the `<section>` itself, so the inner scroller is what keeps the footer pinned. Confirm the pane's own scrollbar is gone and the inner one works.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS. `i18n.test.tsx` verifies both bundles have every key.

- [ ] **Step 8: Look at it**

`npm run dev`, click the trigger, switch through all six entries. Confirm each swatch shows its own theme's colours, and that switching is instant with no flash.

- [ ] **Step 9: Commit**

```bash
git add src/features/appearance src/app/AppShell.tsx src/ui/Icon.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(appearance): a grouped theme picker in the sidebar footer"
```

---

## Task 8: The spacing scale

**Files:**
- Modify: `scripts/sourceLint.test.ts`, every component using an off-scale step, `docs/design/DESIGN-bear-web.md`

- [ ] **Step 1: Write the failing test**

Add to `scripts/sourceLint.test.ts`:

```ts
describe('the spacing scale', () => {
  // Tailwind's grid permits every step, which is not a scale. The shipped code
  // used ten of them with no rule, and that drift is what reads as
  // misalignment. Permitted: 2 4 8 12 16 24 32 48 px.
  const PERMITTED = new Set(['0', '0.5', '1', '2', '3', '4', '6', '8', '12', 'px', 'auto', 'full']);
  const UTILITY = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(\[?[\w.%[\]()-]+)/g;

  /**
   * Off-scale values with a stated reason, in the shape of the focus-outline
   * allowlist. An arbitrary value is an escape hatch, not a forbidden thing —
   * but each one is named here so it is a decision rather than a drift.
   */
  const ALLOWED = {
    'src/features/editor/RichEditor.tsx':
      'pt-12/pb-24 reserve the space the floating toolbars overlay; asserted by appearance.spec.ts',
  } as const;

  it('uses only permitted spacing steps', () => {
    const offenders: string[] = [];

    for (const path of walk('src', ['.tsx'])) {
      if (path in ALLOWED) continue;
      const source = readFileSync(path, 'utf8');
      for (const [whole, step] of source.matchAll(UTILITY)) {
        if (!PERMITTED.has(step)) offenders.push(`${path}  ${whole}`);
      }
    }

    expect(offenders, `off-scale spacing:\n${offenders.join('\n')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the list**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: FAIL, naming every off-scale site. Known offenders: `px-1.5`, `px-3` (permitted — `3` is 12px), `pl-7`, `p-5`, `gap-0.5` (permitted — 2px). The genuine ones are `1.5` (6px), `5` (20px), `7` (28px).

- [ ] **Step 3: Snap each site**

| Found | Becomes | Reason |
| --- | --- | --- |
| `px-1.5` (6) | `px-2` (8) | Nearest permitted step |
| `p-5` (20) | `p-4` (16) or `p-6` (24) | Choose by which neighbour the surface reads better against; state which in the commit |
| `pl-7` (28) | `pl-8` (32) | Nearest permitted step |

`SidebarRow`'s `INDENT_REM = 0.75` (12px) is already on scale and stays.

- [ ] **Step 4: Run the test to green**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing broke visually**

Run: `npm run test:e2e && npm run measure`

The measurements **will** change — that is the point. Read the diff and confirm every change is one of the snaps above. A change to a surface you did not touch is a regression, not a snap.

- [ ] **Step 6: Revise the doc's ruling**

In `DESIGN-bear-web.md`, replace **"Why there are no spacing tokens"** with a section stating the permitted subset, why a fully-permissive grid is not a scale, and that the rule is enforced by `sourceLint` rather than by convention. Keep the original reasoning visible as the superseded ruling — this project records reversals rather than hiding them.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(spacing): state the scale and enforce it, replacing the no-tokens ruling"
```

---

## Task 9: The type scale

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/index.css`, `src/styles/editor.css`, `docs/design/DESIGN-bear-web.md`

- [ ] **Step 1: Add weight and tracking to each UI step**

Hierarchy currently comes from size alone, which is why the chrome reads flat. In `tokens.css`'s global block:

```css
  /* Weight and tracking are part of a step, not applied ad hoc at call sites.
     Size alone carries too little hierarchy at 11–16px, which is why the
     chrome read flat. */
  --bear-weight-ui: 400;
  --bear-weight-ui-strong: 600;
  --bear-tracking-tight: -0.011em;
  --bear-tracking-normal: 0;
```

In `index.css`'s `@theme inline`:

```css
  --text-ui-md--font-weight: var(--bear-weight-ui-strong);
  --text-ui-md--letter-spacing: var(--bear-tracking-tight);
  --text-ui-lg--font-weight: var(--bear-weight-ui-strong);
  --text-ui-lg--letter-spacing: var(--bear-tracking-tight);
```

- [ ] **Step 2: Prove the utilities exist**

```bash
npm run build && grep -c 'letter-spacing' dist/assets/*.css
```

Expected: non-zero. **A token no rule consumes is indistinguishable from a token that does not exist**, and this project has shipped that defect three times (`--color-hover`, `--bear-line-width`, `--bear-para-*`).

- [ ] **Step 3: Choose the editor heading scale**

`DESIGN-bear-web.md` records that the heading scale was never trustworthily measured and warns against acting on the remembered figures. Bear is no longer the authority, so choose deliberately. In `editor.css`:

```css
  /* A modular scale at 1.2, chosen rather than measured: the Bear figures
     these replace were never recorded trustworthily, and Bear is no longer
     the authority. Stated here so a future change is a decision. */
  --bear-h1-scale: 1.728; /* 1.2^3 */
  --bear-h2-scale: 1.44;  /* 1.2^2 */
  --bear-h3-scale: 1.2;
```

Apply as multiples of `--bear-font-size`, keeping the existing rule that spacing is stated twice — once on `> * + *`, once on the heading rule — because those two have equal specificity and the heading one wins on source order.

- [ ] **Step 4: Verify the tokens reach the render**

`e2e/appearance.spec.ts` already has "the editor typography tokens reach the rendered prose", which sets each token from the page and asserts the render moves. Extend it to the three heading scales. **Verify by fault injection**: set `--bear-h2-scale` to `1` and confirm the test fails.

- [ ] **Step 5: Run everything, then commit**

```bash
npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat(type): give each step weight and tracking, and choose the heading scale"
```

---

## Task 10: The Soft Depth pass

Everything so far is contract and colour. This is the shape.

**Files:**
- Modify: `src/app/AppShell.tsx`, `src/ui/Pane.tsx`, `src/ui/SidebarRow.tsx`, `src/features/notes/NoteListItem.tsx`

- [ ] **Step 1: Set the pane gutter to 8**

In `AppShell.tsx`, the flex container's padding and the gap between panes both become `p-2` / `gap-2` (8px). The mockup's 9px is snapped to 8 — imperceptible, and it is what makes the scale statable.

- [ ] **Step 2: Panes take `radius-lg`**

`Pane.tsx` already carries `rounded-lg shadow-popover`; both now resolve per-theme (12px and the two-layer shadow in indigo, 6px and `none` in High Contrast). No change to `Pane.tsx` itself — verify by switching themes that the radius actually moves.

- [ ] **Step 3: The sidebar dissolves into the ground**

`indigo-light` and `indigo-dark` already set `--bear-sidebar` equal to `--bear-canvas`. Remove the sidebar pane's shadow and radius so it reads as ground rather than as a card:

```tsx
<Pane label={t('pane.sidebar')} width={widths.sidebarWidth} className="bg-sidebar flex flex-col !shadow-none">
```

Prefer a `shadow` prop on `Pane` over `!important` if a second caller ever needs it; with one caller the override is honest.

- [ ] **Step 4: Rows become chips**

`SidebarRow`'s row button: height `h-8` (32px, from `h-6`), padding `px-3` (12px), `rounded-md`. `NoteListItem`: `p-3` (12px), `mx-2 my-1` (8/4), `rounded-md`.

**`NoteListItem` keeps its explicit `aria-label`.** Its three sibling spans concatenate with no separator and accessible-name computation ignores the CSS gap — the row announced as `"Groceries14:32milk"` from M3 until M7. A restyle must not drop it.

- [ ] **Step 5: Check every theme**

`npm run dev`, switch through all five. Confirm the sidebar reads as ground in the indigo themes and still has a visible boundary in High Contrast — where the shadow is `none`, so only the border separates it.

- [ ] **Step 6: Capture the result**

```bash
npm run shots && npm run measure
```

Read `docs/design/measurements.md`'s diff and confirm the geometry matches the snapped table in the spec: gutter 8, pane radius 12, sidebar row 32, note row 12 padding.

- [ ] **Step 7: Run the whole gate**

Run: `npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build`

`e2e/appearance.spec.ts` asserts relationships rather than pixels precisely so this pass does not become a test-editing exercise. If one fails, it is reporting a behaviour change — diagnose before editing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(layout): apply Soft Depth — 8px gutter, themed radii, rows as chips"
```

---

## Task 11: Flip the default, and close the docs

**Files:**
- Modify: `src/styles/themes.ts`, `src/styles/tokens.css`, `e2e/smoke.spec.ts`, `e2e/appearance.spec.ts`, `e2e/shots.spec.ts`, `e2e/measure.spec.ts`, `CLAUDE.md`, `docs/design/DESIGN-bear-web.md`

- [ ] **Step 1: Move the default**

In `themes.ts`: `DEFAULT_THEME_ID = 'indigo-light'`, `SYSTEM_DARK_ID = 'indigo-dark'`.
In `tokens.css`: `:root` now carries indigo-light's values (paired with `:root[data-theme='indigo-light']`), and the `prefers-color-scheme` block carries indigo-dark's.

The Task 1 assertions — `:root` identical to the default block, system-dark identical to its named theme — now do real work. Run `npx vitest run scripts/sourceLint.test.ts` and confirm they pass.

- [ ] **Step 2: Update the pinned palette**

`e2e/smoke.spec.ts` pins the shipped palette deliberately — it is the only test proving the `prefers-color-scheme` cascade reaches a rendered pixel, so a palette change **should** cost a conscious edit. **This is the licensed instance.** Replace the pinned values with indigo's and say so in the commit message.

- [ ] **Step 3: Add the theme e2e tests**

In `e2e/appearance.spec.ts`:

```ts
test('a chosen theme survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme/i }).click();
  await page.getByRole('menuitemradio', { name: 'Ink' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
});

// The mirror exists solely to beat first paint. A late-stamping implementation
// still ends up correct, so asserting after load proves nothing — this reads
// the attribute at the earliest observable moment instead.
test('the theme is stamped before first paint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme/i }).click();
  await page.getByRole('menuitemradio', { name: 'Ink' }).click();

  const stamped: string[] = [];
  await page.exposeFunction('record', (value: string) => void stamped.push(value));
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      // @ts-expect-error injected above
      window.record(`${document.readyState}:${document.documentElement.dataset.theme}`);
    });
  });

  await page.reload();
  expect(stamped[0]).toBe('interactive:ink');
});
```

**Verify by fault injection:** remove the inline script from `index.html`, confirm this test fails, restore it.

- [ ] **Step 4: Iterate the roster in shots and measure**

Both currently capture one theme. Wrap each in a loop over `THEMES`, writing to `docs/design/shots/<theme-id>/…`. Neither is in the `npm run test:e2e` gate (`grepInvert` on `@shots|@measure`), so this does not slow CI.

- [ ] **Step 5: Run every gate, including the two that are not gates**

```bash
npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run format && npm run build
npm run shots && npm run measure
```

- [ ] **Step 6: Look at every screenshot**

Open all five themes' shots. **This is the only step in the plan that can catch "renders wrong"** — the unit suite has no layout engine and `appearance.spec.ts` is deliberately relative.

- [ ] **Step 7: Update `CLAUDE.md`**

- Status table: M9a complete; M9b callouts and M9c collapsible headings next.
- Opening description: the app is no longer "modeled on the Bear macOS app" — state the real goal and that Bear is a reference.
- New rulings, in the existing voice: the three-tier token contract and why density is not themeable; the `:not([data-theme])` guard and the defect the old selector would cause; the mirror is a cache and the settings table wins; the pre-paint script duplicates the roster on purpose and what stops it drifting; the permitted spacing subset replacing the no-tokens ruling; the contrast harness retiring "no test can catch this"; High Contrast being the only theme that stresses the surface tier and why a shadowless popover needs a border.
- Test count and e2e count.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(themes): make Indigo Light the default, and pin the new palette deliberately"
```

---

## Self-Review

**Spec coverage.** §2 token contract → Task 1. §3 roster → Tasks 1, 3, 4. §4 picker and persistence → Tasks 5, 6, 7. §5 spacing → Task 8; type → Task 9; snapping table → Task 10. §6.1 contrast harness → Task 2. §6.2 sourceLint → Tasks 1, 5, 8. §6.3 appearance e2e → Tasks 9, 11. §6.4 smoke/shots/measure → Task 11. §7 consequences → Task 11 step 7. **No gap found.**

**Placeholders.** None: every code step carries the actual content. The one deliberately open decision is Task 8 step 3's `p-5` → `p-4` or `p-6`, which is a judgement about a specific surface and is required to be stated in its commit message.

**Type consistency.** `ThemeId`, `ThemeChoice`, `THEME_KEY`, `MIRROR_KEY`, `readMirror`, `writeMirror`, `applyTheme`, `useTheme`, `THEMES`, `DEFAULT_THEME_ID`, `SYSTEM_DARK_ID`, `Rgba`, `parseColour`, `composite`, `contrastRatio`, `Popover`, `ThemePicker` — each defined once and used consistently downstream.

**One trap, already defused.** `blockTokens` finds a block by `indexOf(selector)` plus the next `{`, so it cannot read a grouped selector, and `':root {'` matches the tier-3 global block. Task 1 therefore keeps the default palette in `:root` alongside the globals and repeats it in a flat named block, with the equality assertion comparing only the 22 required tokens. An implementer who "tidies" this into `:root, :root[data-theme='…']` will break the lint for a reason that has nothing to do with their change.
