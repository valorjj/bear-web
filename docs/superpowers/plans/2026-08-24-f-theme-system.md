# F — Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the theme roster from five to sixteen by giving new themes derived defaults, and replace the picker with a modal card grid.

**Architecture:** `:root` derives twelve tokens with `color-mix()` from eight chosen per-theme values plus a single `--bear-dark: 0|1` scalar. The five shipped themes keep every hand-tuned value and render byte-identically; the eleven new ones take the defaults. The picker becomes a modal dialog built on a new reusable `src/ui/Dialog.tsx`.

**Tech Stack:** CSS custom properties + `color-mix()`, Tailwind v4 `@theme inline`, React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-f-theme-system-design.md`

## Global Constraints

- **First paint must stay free of JavaScript.** `src/app/theme.ts` (`applyTheme`, `readMirror`, `MIRROR_KEY`) is not touched by any task. **`index.html` IS touched, in exactly one place and no other:** its inline script hardcodes `var known = ['indigo-light', 'indigo-dark', 'paper', 'ink', 'high-contrast']`, and `scripts/sourceLint.test.ts`'s "lists exactly the roster ids" test fails if a roster entry is missing from it. The list is duplicated deliberately — the script cannot import the roster, because a module import is async and the whole point is to run before first paint. **A theme added to the roster but missing from `known` silently loses its no-flash behaviour**, which is why that test exists. Tasks 4 and 5 each update it.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` is a defect, enforced by `scripts/sourceLint.test.ts`.
- **No user-facing string is hardcoded in a component.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is `Record<TranslationKey, string>` so a missing translation is a compile error. Never weaken that annotation.
- **`src/ui/` must import nothing from `src/app/`, `src/data/`, `src/features/` or `src/i18n/`.** Enforced by `scripts/sourceLint.test.ts`, which resolves both `@/`-aliased and relative specifiers.
- **Two colour spaces, deliberately:** `oklab` for opaque mixes, `srgb` for alpha tints. Mixing with `transparent` in `oklab` shifts hue as it fades.
- **All six gates pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **Before any e2e run that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is silently reused and the suite tests a stale build.
- **Check `uptime` before concluding a diff broke the e2e suite.** Several tests are timing-sensitive and fail under load; three genuine races were found and fixed this way in E.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/contrast.ts` | Modify: `parseColour` learns `color(srgb …)`. |
| `scripts/contrast.test.ts` | Create: unit tests for the parser (does not exist today). |
| `e2e/fixtures/themeBaseline.json` | Create: computed values of all 26 tokens × 5 shipped themes, captured before the refactor. |
| `e2e/themeBaseline.spec.ts` | Create: asserts the five shipped themes still match the fixture. |
| `src/styles/tokens.css` | Modify: `:root` gains derived defaults and scalar interpolation; eleven new theme blocks. |
| `index.html` | Modify: the inline script's `var known = [...]` list, which must list every roster id. |
| `src/styles/themes.ts` | Modify: `ThemeId` and `THEMES` grow to sixteen. |
| `src/i18n/en.ts`, `ko.ts` | Modify: eleven new `theme.*` labels each. |
| `scripts/sourceLint.test.ts` | Modify: base-token assertion + `:root` completeness assertion. |
| `src/ui/Dialog.tsx` | Create: modal shell — backdrop, role, `aria-modal`, Escape, focus trap, focus restore. |
| `src/ui/ConfirmDialog.tsx` | Modify: built on `Dialog`, closing its documented `'button'`-only trap gap. |
| `src/features/appearance/ThemeDialog.tsx` | Create: scrollable two-column card grid. |
| `src/features/appearance/ThemePicker.tsx` | Modify: trigger opens `ThemeDialog` instead of a `Popover` list. |

---

### Task 1: Teach `parseColour` the `color(srgb …)` format

Every derived token computes to `color(srgb 0.36 0.29 0.84 / 0.12)`. `parseColour` handles `#hex` and `rgb()` only; its fallback strips an `rgb(` prefix and `Number()`s the rest, so `color(srgb …)` yields `NaN` — and a contrast ratio computed from `NaN` **can pass**. The harness would go blind exactly as the roster grows. This is task one for that reason.

**Files:**
- Modify: `scripts/contrast.ts:30-53`
- Create: `scripts/contrast.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseColour(css: string): Rgba` accepting `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, and `color(srgb r g b [/ a])` where `r g b` are 0–1 floats. `Rgba` is `{ r: number; g: number; b: number; a: number }` with `r`/`g`/`b` in 0–255.

- [ ] **Step 1: Write the failing test**

Create `scripts/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColour } from './contrast';

describe('parseColour', () => {
  it('reads a six-digit hex', () => {
    expect(parseColour('#5b4ad6')).toEqual({ r: 91, g: 74, b: 214, a: 1 });
  });

  it('reads an rgb() triple with a slash alpha', () => {
    expect(parseColour('rgb(91 74 214 / 0.12)')).toEqual({ r: 91, g: 74, b: 214, a: 0.12 });
  });

  // The format EVERY derived token computes to. Before this, the fallback
  // path stripped an `rgb(` prefix that is not there, `Number()`d
  // "color(srgb" and produced NaN — and `contrastRatio` of NaN is NaN, which
  // compares false against every floor and so reads as a PASS in the
  // harness's `ratio < min` test. Silent blindness, not a loud failure.
  it('reads color(srgb …) with 0–1 components', () => {
    const parsed = parseColour('color(srgb 0.356863 0.290196 0.839216)');
    expect(parsed.r).toBeCloseTo(91, 0);
    expect(parsed.g).toBeCloseTo(74, 0);
    expect(parsed.b).toBeCloseTo(214, 0);
    expect(parsed.a).toBe(1);
  });

  it('reads color(srgb …) with a slash alpha', () => {
    expect(parseColour('color(srgb 0 0 0 / 0.4)').a).toBeCloseTo(0.4, 5);
  });

  // The guard that makes the three above worth having: a NaN channel must
  // never reach `contrastRatio`, because NaN silently satisfies `ratio < min`
  // being false.
  it('never yields NaN for any format the harness can meet', () => {
    for (const css of [
      '#fff',
      '#ffffff',
      '#ffffff80',
      'rgb(255 255 255)',
      'rgba(255, 255, 255, 0.5)',
      'color(srgb 1 1 1)',
      'color(srgb 1 1 1 / 0.5)',
    ]) {
      const { r, g, b, a } = parseColour(css);
      expect(Number.isNaN(r + g + b + a), `${css} produced NaN`).toBe(false);
    }
  });

  it('produces a real ratio for two color(srgb …) values', () => {
    const ratio = contrastRatio(parseColour('color(srgb 1 1 1)'), parseColour('color(srgb 0 0 0)'));
    expect(ratio).toBeCloseTo(21, 1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run scripts/contrast.test.ts`
Expected: the two `color(srgb …)` tests and the NaN guard FAIL. The hex and `rgb()` tests PASS — that asymmetry is the point.

- [ ] **Step 3: Implement**

In `scripts/contrast.ts`, insert this branch inside `parseColour`, immediately after the `#` branch and before the existing `rgb(` fallback:

```ts
  // `color(srgb r g b / a)` — what every `color-mix()`-derived token computes
  // to. Components are 0–1 floats here, unlike `rgb()`'s 0–255, so they are
  // scaled. Without this branch the fallback below strips an `rgb(` prefix
  // that is not present, `Number()`s "color(srgb" and yields NaN — and NaN
  // makes the harness's `ratio < min` false, i.e. a silent pass.
  if (text.startsWith('color(')) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const [space, ...rest] = inner.split(/[\s,/]+/).filter(Boolean);
    if (space !== 'srgb') {
      throw new Error(`parseColour: unsupported colour space ${String(space)}`);
    }
    const [r = 0, g = 0, b = 0, a] = rest.map(Number);
    return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a };
  }
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run scripts/contrast.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and the contrast harness**

Run: `npx vitest run` then `lsof -ti:4173 | xargs -r kill -9 && npx playwright test contrast --reporter=line`
Expected: unit suite green; 6 contrast tests pass, unchanged.

- [ ] **Step 6: Commit**

```bash
git add scripts/contrast.ts scripts/contrast.test.ts
git commit -m "fix(contrast): parseColour was silently blind to color(srgb)"
```

---

### Task 2: Capture the shipped themes' computed values as a baseline

This must land **before** any derivation, or there is nothing to compare against. It is the test that makes the refactor reviewable: the spec's measurement showed a plausible-looking derivation off by up to 17/255 per channel, so "a colour drifted slightly" is a real risk, not a hypothetical.

**Files:**
- Create: `e2e/themeBaseline.spec.ts`
- Create: `e2e/fixtures/themeBaseline.json` (generated in Step 2, then committed)

**Interfaces:**
- Consumes: `parseColour` from Task 1.
- Produces: `e2e/fixtures/themeBaseline.json`, shape `Record<ThemeId, Record<string, string>>` — theme id → token name (without the `--bear-` prefix) → computed value string.

- [ ] **Step 1: Write the spec that reads and compares**

Create `e2e/themeBaseline.spec.ts`:

```ts
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { parseColour } from '../scripts/contrast';

/**
 * The five themes that shipped before F must render byte-identically after
 * it. F derives DEFAULTS for new themes; it deliberately does not re-derive
 * these, because measurement showed no single ratio reproduces their
 * hand-tuned chroma — a plausible derivation was off by up to 17/255 per
 * channel (see the spec).
 *
 * Comparison is by parsed RGBA, not by string: a value that used to read
 * `rgb(…)` may legitimately read `color(srgb …)` after F while denoting the
 * same colour.
 */
const BASELINE = JSON.parse(
  readFileSync(new URL('./fixtures/themeBaseline.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string>>;

const TOKENS = [
  'bg', 'surface', 'sidebar', 'canvas', 'text', 'muted', 'faint', 'border',
  'accent', 'danger', 'focus', 'hover', 'selected', 'shadow',
  'tag-fill', 'tag-fill-strong',
  'hl-blue', 'hl-green', 'hl-pink', 'hl-purple',
];

test('the baseline fixture covers every shipped theme', () => {
  // Guards the guard: an empty or truncated fixture would make every
  // assertion below vacuous.
  expect(Object.keys(BASELINE).sort()).toEqual(
    ['high-contrast', 'indigo-dark', 'indigo-light', 'ink', 'paper'],
  );
  for (const tokens of Object.values(BASELINE)) {
    expect(Object.keys(tokens).sort()).toEqual([...TOKENS].sort());
  }
});

for (const id of ['paper', 'indigo-light', 'indigo-dark', 'ink', 'high-contrast']) {
  test(`${id} renders exactly as it did before F`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('section[aria-label]')).toHaveCount(3);

    const actual = await page.evaluate(
      ({ theme, names }) => {
        document.documentElement.setAttribute('data-theme', theme);
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(`--bear-${name}`).trim()]),
        ) as Record<string, string>;
      },
      { theme: id, names: TOKENS },
    );

    const drifted: string[] = [];
    for (const name of TOKENS) {
      expect(actual[name], `--bear-${name} resolved to nothing in ${id}`).toBeTruthy();
      // `transparent` is a keyword, not a colour function: high-contrast's
      // shadow is exactly that, and parsing it is neither possible nor useful.
      if (actual[name] === BASELINE[id]![name]) continue;
      const a = parseColour(actual[name]!);
      const b = parseColour(BASELINE[id]![name]!);
      const delta = Math.max(
        Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b),
        Math.abs(a.a - b.a) * 255,
      );
      if (delta > 1) {
        drifted.push(`--bear-${name}: ${BASELINE[id]![name]} -> ${actual[name]} (Δ${delta.toFixed(1)})`);
      }
    }

    expect(drifted, `${id} drifted:\n${drifted.join('\n')}`).toEqual([]);
  });
}
```

- [ ] **Step 2: Generate the fixture from the CURRENT build**

The fixture must be captured before any derivation lands. Run this once:

```bash
lsof -ti:4173 | xargs -r kill -9
mkdir -p e2e/fixtures
cat > /tmp/capture.spec.ts <<'EOF'
import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
const TOKENS = ['bg','surface','sidebar','canvas','text','muted','faint','border','accent','danger','focus','hover','selected','shadow','tag-fill','tag-fill-strong','hl-blue','hl-green','hl-pink','hl-purple'];
test('capture', async ({ page }) => {
  await page.goto('/');
  const out: Record<string, Record<string,string>> = {};
  for (const id of ['paper','indigo-light','indigo-dark','ink','high-contrast']) {
    out[id] = await page.evaluate(({theme,names}) => {
      document.documentElement.setAttribute('data-theme', theme);
      const s = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map(n => [n, s.getPropertyValue(`--bear-${n}`).trim()]));
    }, {theme:id, names:TOKENS});
  }
  writeFileSync('e2e/fixtures/themeBaseline.json', JSON.stringify(out, null, 2) + '\n');
});
EOF
cp /tmp/capture.spec.ts e2e/__capture.spec.ts
npx playwright test __capture --reporter=line
rm e2e/__capture.spec.ts /tmp/capture.spec.ts
```

Then read `e2e/fixtures/themeBaseline.json` and confirm it holds five themes × 20 tokens with real values. **If any value is empty, stop** — the page had not mounted and the fixture is worthless.

- [ ] **Step 3: Run the baseline spec and verify it passes against unchanged CSS**

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test themeBaseline --reporter=line`
Expected: 6 tests PASS. It must pass now — it is capturing the status quo.

- [ ] **Step 4: Prove it can fail**

Temporarily change one value in `src/styles/tokens.css` — e.g. `[data-theme='ink']`'s `--bear-accent` from `#ff6f5e` to `#ff6f5f` — and re-run.

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test themeBaseline --reporter=line`
Expected: the `ink` test FAILS naming `--bear-accent`. A one-step change must be caught, since the tolerance is one 8-bit step. **Revert the edit** and re-run to confirm green.

- [ ] **Step 5: Commit**

```bash
git add e2e/themeBaseline.spec.ts e2e/fixtures/themeBaseline.json
git commit -m "test(themes): pin the five shipped palettes before deriving anything"
```

---

### Task 3: Derive defaults in `:root`, leaving every shipped theme untouched

**Files:**
- Modify: `src/styles/tokens.css` (`:root` only; no `[data-theme]` block changes)
- Modify: `scripts/sourceLint.test.ts`

**Interfaces:**
- Consumes: the baseline spec from Task 2 — it must stay green through this task, which is the whole point of the ordering.
- Produces: `:root` defines all 20 colour tokens, so a later theme block may declare only the eight base ones. New custom properties available to later tasks: `--bear-dark` (a unitless number, 0 or 1), and the derived `--bear-tint`, `--bear-tint-mid`, `--bear-tint-strong`, `--bear-hover-a`, `--bear-hl-a`.

- [ ] **Step 1: Add the scalar and the derived defaults to `:root`**

In `src/styles/tokens.css`, inside the `:root { … }` block, after the existing palette declarations, add:

```css
  /* ------------------------------------------------- derived theme defaults */

  /*
   * A theme declares eight colours and this scalar; everything below is
   * derived from them. The five themes that shipped before F declare their
   * own values for most of these and therefore never reach this block —
   * deliberately. Measurement showed no single ratio reproduces their
   * hand-tuned chroma (indigo-dark's `muted` is visibly violet where a
   * text-to-bg mix gives a near-grey, off by 17/255), so these are DEFAULTS
   * FOR NEW THEMES, not a reconstruction of the old ones. See
   * `docs/superpowers/specs/2026-08-24-f-theme-system-design.md`.
   *
   * `--bear-dark` is a NUMBER, not a keyword, precisely so `calc()` can
   * interpolate the five alpha scalars from it — one declaration per theme
   * instead of five. It is independent of `themes.ts`'s `group`, which stays
   * hand-declared because the picker's grouping must not become a side
   * effect of a colour edit.
   */
  --bear-dark: 0;

  --bear-tint: calc(0.1 + 0.09 * var(--bear-dark));
  --bear-tint-mid: calc(0.13 + 0.08 * var(--bear-dark));
  --bear-tint-strong: calc(0.28 + 0.07 * var(--bear-dark));
  --bear-hover-a: calc(0.05 + 0.01 * var(--bear-dark));
  --bear-hl-a: calc(0.2 + 0.08 * var(--bear-dark));

  /*
   * Opaque mixes use `oklab`: perceptual evenness is the only reason one
   * ratio can serve sixteen palettes, since an sRGB midpoint lands visibly
   * darker in some hues than others.
   */
  --bear-muted: color-mix(in oklab, var(--bear-text) 68%, var(--bear-bg));
  --bear-faint: color-mix(in oklab, var(--bear-text) 51%, var(--bear-bg));
  --bear-border: color-mix(in oklab, var(--bear-text) 13%, var(--bear-bg));
  --bear-focus: var(--bear-accent);

  /*
   * Alpha tints use `srgb`: mixing a colour with `transparent` in `oklab`
   * interpolates through a premultiplied space and shifts hue as it fades,
   * which is not the plain alpha these tokens have always been.
   */
  --bear-hover: color-mix(in srgb, var(--bear-text) calc(var(--bear-hover-a) * 100%), transparent);
  --bear-selected: color-mix(in srgb, var(--bear-accent) calc(var(--bear-tint) * 100%), transparent);
  --bear-tag-fill: color-mix(in srgb, var(--bear-accent) calc(var(--bear-tint-mid) * 100%), transparent);
  --bear-tag-fill-strong: color-mix(
    in srgb,
    var(--bear-accent) calc(var(--bear-tint-strong) * 100%),
    transparent
  );

  /* Fixed hues; only the alpha follows the scheme. */
  --bear-hl-hue-blue: #2563eb;
  --bear-hl-hue-green: #16a34a;
  --bear-hl-hue-pink: #db2777;
  --bear-hl-hue-purple: #9333ea;
  --bear-hl-blue: color-mix(in srgb, var(--bear-hl-hue-blue) calc(var(--bear-hl-a) * 100%), transparent);
  --bear-hl-green: color-mix(in srgb, var(--bear-hl-hue-green) calc(var(--bear-hl-a) * 100%), transparent);
  --bear-hl-pink: color-mix(in srgb, var(--bear-hl-hue-pink) calc(var(--bear-hl-a) * 100%), transparent);
  --bear-hl-purple: color-mix(in srgb, var(--bear-hl-hue-purple) calc(var(--bear-hl-a) * 100%), transparent);
```

**Critical ordering:** these must come AFTER `:root`'s existing `--bear-muted`, `--bear-faint` etc. so they win within `:root`, and every `[data-theme]` block already appears after `:root` in the file so a theme's own value still wins overall. Do not move any `[data-theme]` block.

- [ ] **Step 2: Run the baseline spec — the five themes must be unchanged**

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test themeBaseline --reporter=line`
Expected: 6 PASS.

**If `indigo-light` drifts, that is expected and is the one real conflict:** `:root` doubles as the default theme's block, so the derived defaults now override `indigo-light`'s hand-tuned values *for a visitor with no `data-theme` attribute*. Fix by moving `:root`'s palette declarations to come AFTER the derived block — the derived values then act as fallbacks that `:root`'s own palette overrides, exactly as a theme block does. Re-run until green.

- [ ] **Step 3: Reshape the source lint**

In `scripts/sourceLint.test.ts`, replace the `it('gives every theme in the roster a CSS block defining all 26 tokens', …)` test with:

```ts
  // A theme now declares eight colours plus `--bear-dark` and inherits the
  // rest from `:root`'s derived defaults. Splitting the old single assertion
  // into two is strictly stronger than weakening it: every theme still has to
  // declare its own identity, and `:root` still has to make every token a
  // component consumes resolve for every theme.
  const BASE = ['bg', 'surface', 'sidebar', 'canvas', 'text', 'accent', 'danger', 'shadow'];

  it('gives every theme in the roster a CSS block defining all 8 base tokens', () => {
    for (const id of ids) {
      const block = blockTokens(css, `[data-theme='${id}']`);
      for (const token of BASE) {
        expect(block.has(`--bear-${token}`), `--bear-${token} missing from ${id}`).toBe(true);
      }
      expect(block.has('--bear-dark'), `--bear-dark missing from ${id}`).toBe(true);
    }
  });

  it('defines every token in :root, so any theme may omit the derived ones', () => {
    const root = blockTokens(css, ':root {');
    for (const token of REQUIRED) {
      expect(root.has(`--bear-${token}`), `--bear-${token} missing from :root`).toBe(true);
    }
  });
```

Then change the two `:root` agreement tests to iterate `BASE` rather than `REQUIRED`, and update their comments to say why:

```ts
    // Narrowed from every token to the BASE ones: `:root` now legitimately
    // carries derived values a theme block does not repeat, so comparing all
    // 26 would fail on tokens the theme never declared. The M2-era hazard —
    // a token right for someone who picked dark and wrong for someone whose
    // OS is dark — can only occur in a DECLARED token, which is what this
    // still covers.
```

- [ ] **Step 4: Add `--bear-dark: 0` or `1` to the five existing theme blocks**

`paper`, `indigo-light` → `--bear-dark: 0;`
`indigo-dark`, `ink`, `high-contrast` → `--bear-dark: 1;`

Add it as the first declaration in each block. These themes override every derived token anyway, so this only satisfies the lint and documents the scheme — but a new theme copied from one of them will then be correct by default.

- [ ] **Step 5: Run every gate**

```bash
npx vitest run
npx tsc -b
npm run lint
npx prettier --write . && npx prettier --check .
npm run build
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
```
Expected: all green, including the 6 baseline tests and the 6 contrast tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css scripts/sourceLint.test.ts
git commit -m "feat(themes): derive defaults in :root so a new theme costs eight values"
```

---

### Task 4: Add the six new light themes

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/themes.ts`, `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `--bear-dark` and the derived defaults from Task 3.
- Produces: `ThemeId` gains `'solarized-light' | 'rose-dawn' | 'latte' | 'gruvbox-light' | 'snow' | 'sepia'`.

**The palette values below are STARTING POINTS taken from each scheme's published palette. The contrast harness is the gate, not this plan.** Solarized in particular is known to sit близко to the floor; where a value must be adjusted, adjust it and add a comment saying what changed and why. Fidelity loses to legibility.

- [ ] **Step 1: Add the six blocks to `src/styles/tokens.css`**

Place them after `[data-theme='paper']` and before the dark blocks.

```css
/* Solarized Light — Ethan Schoonover's scheme (MIT). `text` is base01
   (#586e75) rather than base00 (#657b83): base00 measures below 4.5:1 on
   base3 and the harness rejects it. Fidelity loses to legibility. */
[data-theme='solarized-light'] {
  --bear-dark: 0;
  --bear-bg: #fdf6e3;
  --bear-surface: #f7f0d8;
  --bear-sidebar: #eee8d5;
  --bear-canvas: #e4ddc8;
  --bear-text: #586e75;
  --bear-accent: #268bd2;
  --bear-danger: #dc322f;
  --bear-shadow: rgb(88 110 117 / 0.14);
}

/* Rosé Dawn — the Rosé Pine Dawn variant (MIT). */
[data-theme='rose-dawn'] {
  --bear-dark: 0;
  --bear-bg: #faf4ed;
  --bear-surface: #fffaf3;
  --bear-sidebar: #f2e9e1;
  --bear-canvas: #e9e0d6;
  --bear-text: #575279;
  --bear-accent: #907aa9;
  --bear-danger: #b4637a;
  --bear-shadow: rgb(87 82 121 / 0.12);
}

/* Latte — the Catppuccin Latte flavour (MIT). */
[data-theme='latte'] {
  --bear-dark: 0;
  --bear-bg: #eff1f5;
  --bear-surface: #e6e9ef;
  --bear-sidebar: #dce0e8;
  --bear-canvas: #ccd0da;
  --bear-text: #4c4f69;
  --bear-accent: #8839ef;
  --bear-danger: #d20f39;
  --bear-shadow: rgb(76 79 105 / 0.12);
}

/* Gruvbox Light — morhetz's scheme (MIT). */
[data-theme='gruvbox-light'] {
  --bear-dark: 0;
  --bear-bg: #fbf1c7;
  --bear-surface: #f2e5bc;
  --bear-sidebar: #ebdbb2;
  --bear-canvas: #d5c4a1;
  --bear-text: #3c3836;
  --bear-accent: #af3a03;
  --bear-danger: #9d0006;
  --bear-shadow: rgb(60 56 54 / 0.14);
}

/* Snow — built from Nord's own Snow Storm range (MIT). Nord ships no
   official light theme; this is ours, named honestly rather than implying
   an upstream that does not exist. */
[data-theme='snow'] {
  --bear-dark: 0;
  --bear-bg: #eceff4;
  --bear-surface: #e5e9f0;
  --bear-sidebar: #d8dee9;
  --bear-canvas: #cfd6e0;
  --bear-text: #2e3440;
  --bear-accent: #5e81ac;
  --bear-danger: #bf616a;
  --bear-shadow: rgb(46 52 64 / 0.12);
}

/* Sepia — ours. A warm reading theme, the light counterpart to Ink. */
[data-theme='sepia'] {
  --bear-dark: 0;
  --bear-bg: #f4ecd8;
  --bear-surface: #efe6d0;
  --bear-sidebar: #e8dcc0;
  --bear-canvas: #ded0b0;
  --bear-text: #3a2f1e;
  --bear-accent: #8b5a2b;
  --bear-danger: #9c3327;
  --bear-shadow: rgb(58 47 30 / 0.14);
}
```

- [ ] **Step 2: Extend the roster**

In `src/styles/themes.ts`, add to `ThemeId` and to `THEMES` (light group, after `paper`):

```ts
  { id: 'solarized-light', labelKey: 'theme.solarizedLight', group: 'light' },
  { id: 'rose-dawn', labelKey: 'theme.roseDawn', group: 'light' },
  { id: 'latte', labelKey: 'theme.latte', group: 'light' },
  { id: 'gruvbox-light', labelKey: 'theme.gruvboxLight', group: 'light' },
  { id: 'snow', labelKey: 'theme.snow', group: 'light' },
  { id: 'sepia', labelKey: 'theme.sepia', group: 'light' },
```

- [ ] **Step 3a: Add the six ids to `index.html`'s pre-paint list**

`index.html:28` becomes:

```js
          var known = ['indigo-light', 'indigo-dark', 'paper', 'ink', 'high-contrast', 'solarized-light', 'rose-dawn', 'latte', 'gruvbox-light', 'snow', 'sepia'];
```

This is not optional bookkeeping. The inline script runs before first paint
and cannot import the roster (a module import is async), so the list is a
deliberate duplicate. A theme missing from it still *works* — it just flashes
the default theme before React corrects it, which is invisible in every test
except `sourceLint`'s "lists exactly the roster ids".

- [ ] **Step 3: Add both locales**

`src/i18n/en.ts`:

```ts
  'theme.solarizedLight': 'Solarized Light',
  'theme.roseDawn': 'Rosé Dawn',
  'theme.latte': 'Latte',
  'theme.gruvboxLight': 'Gruvbox Light',
  'theme.snow': 'Snow',
  'theme.sepia': 'Sepia',
```

`src/i18n/ko.ts`:

```ts
  'theme.solarizedLight': '솔라라이즈드 라이트',
  'theme.roseDawn': '로즈 던',
  'theme.latte': '라떼',
  'theme.gruvboxLight': '그루브박스 라이트',
  'theme.snow': '스노우',
  'theme.sepia': '세피아',
```

- [ ] **Step 4: Run the contrast harness — this is the gate**

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test contrast --reporter=line`
Expected: 12 tests (1 roster guard + 11 themes), all PASS.

**If a theme fails**, the report names the exact pair and ratio. Fix by overriding the offending token in that theme's block with a value that clears the floor, and add a comment recording what upstream said and what we shipped. Do not lower a floor.

- [ ] **Step 5: Run every gate and look at the result**

```bash
npx vitest run && npx tsc -b && npm run lint && npx prettier --check .
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
```

Then look at them, because no test can see "renders wrong":

```bash
npm run dev
```
Open the app, switch through all six new themes, and confirm each reads as a coherent palette rather than a set of unrelated colours.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css src/styles/themes.ts src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(themes): add six light themes on the derived defaults"
```

---

### Task 5: Add the five new dark themes

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/themes.ts`, `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: everything from Task 3; the same structure as Task 4.
- Produces: `ThemeId` gains `'nord' | 'dracula' | 'solarized-dark' | 'tokyo-night' | 'gruvbox-dark'`, bringing the roster to sixteen.

- [ ] **Step 1: Add the five blocks to `src/styles/tokens.css`**

Place them after `[data-theme='ink']` and before `[data-theme='high-contrast']`.

```css
/* Nord — arcticicestudio's scheme (MIT). */
[data-theme='nord'] {
  --bear-dark: 1;
  --bear-bg: #2e3440;
  --bear-surface: #3b4252;
  --bear-sidebar: #272c36;
  --bear-canvas: #242933;
  --bear-text: #eceff4;
  --bear-accent: #88c0d0;
  --bear-danger: #bf616a;
  --bear-shadow: rgb(0 0 0 / 0.4);
}

/* Dracula — Zeno Rocha's scheme (MIT). */
[data-theme='dracula'] {
  --bear-dark: 1;
  --bear-bg: #282a36;
  --bear-surface: #343746;
  --bear-sidebar: #21222c;
  --bear-canvas: #1a1b23;
  --bear-text: #f8f8f2;
  --bear-accent: #bd93f9;
  --bear-danger: #ff5555;
  --bear-shadow: rgb(0 0 0 / 0.45);
}

/* Solarized Dark — Ethan Schoonover's scheme (MIT). `text` is base1
   (#93a1a1) rather than base0, for the same legibility reason Solarized
   Light raises its own. */
[data-theme='solarized-dark'] {
  --bear-dark: 1;
  --bear-bg: #002b36;
  --bear-surface: #073642;
  --bear-sidebar: #00212b;
  --bear-canvas: #001b22;
  --bear-text: #93a1a1;
  --bear-accent: #268bd2;
  --bear-danger: #dc322f;
  --bear-shadow: rgb(0 0 0 / 0.45);
}

/* Tokyo Night — enkia's scheme (MIT). */
[data-theme='tokyo-night'] {
  --bear-dark: 1;
  --bear-bg: #1a1b26;
  --bear-surface: #24283b;
  --bear-sidebar: #16161e;
  --bear-canvas: #101014;
  --bear-text: #c0caf5;
  --bear-accent: #7aa2f7;
  --bear-danger: #f7768e;
  --bear-shadow: rgb(0 0 0 / 0.5);
}

/* Gruvbox Dark — morhetz's scheme (MIT). */
[data-theme='gruvbox-dark'] {
  --bear-dark: 1;
  --bear-bg: #282828;
  --bear-surface: #3c3836;
  --bear-sidebar: #1d2021;
  --bear-canvas: #171717;
  --bear-text: #ebdbb2;
  --bear-accent: #fe8019;
  --bear-danger: #fb4934;
  --bear-shadow: rgb(0 0 0 / 0.5);
}
```

- [ ] **Step 2: Extend the roster**

In `src/styles/themes.ts`, add to `ThemeId` and to `THEMES` (dark group, after `ink`):

```ts
  { id: 'nord', labelKey: 'theme.nord', group: 'dark' },
  { id: 'dracula', labelKey: 'theme.dracula', group: 'dark' },
  { id: 'solarized-dark', labelKey: 'theme.solarizedDark', group: 'dark' },
  { id: 'tokyo-night', labelKey: 'theme.tokyoNight', group: 'dark' },
  { id: 'gruvbox-dark', labelKey: 'theme.gruvboxDark', group: 'dark' },
```

- [ ] **Step 3a: Add the five ids to `index.html`'s pre-paint list**

Append `'nord'`, `'dracula'`, `'solarized-dark'`, `'tokyo-night'`,
`'gruvbox-dark'` to `var known` so it lists all sixteen. Same reason as Task 4.

- [ ] **Step 3: Add both locales**

`src/i18n/en.ts`:

```ts
  'theme.nord': 'Nord',
  'theme.dracula': 'Dracula',
  'theme.solarizedDark': 'Solarized Dark',
  'theme.tokyoNight': 'Tokyo Night',
  'theme.gruvboxDark': 'Gruvbox Dark',
```

`src/i18n/ko.ts`:

```ts
  'theme.nord': '노르드',
  'theme.dracula': '드라큘라',
  'theme.solarizedDark': '솔라라이즈드 다크',
  'theme.tokyoNight': '도쿄 나이트',
  'theme.gruvboxDark': '그루브박스 다크',
```

- [ ] **Step 4: Run the contrast harness**

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test contrast --reporter=line`
Expected: 17 tests (1 roster guard + 16 themes), all PASS. Same override-and-record rule as Task 4 on any failure.

- [ ] **Step 5: Run every gate, then look at all sixteen**

```bash
npx vitest run && npx tsc -b && npm run lint && npx prettier --check .
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
npm run dev   # switch through every theme
```

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css src/styles/themes.ts src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(themes): add five dark themes, bringing the roster to sixteen"
```

---

### Task 6: Extract `src/ui/Dialog.tsx` and rebuild `ConfirmDialog` on it

Doing this before the theme dialog means the new UI is built on a reviewed primitive rather than the primitive being extracted afterwards to fit it. It also closes a defect `ConfirmDialog` documents in its own comments: its focus trap queries `'button'`, described there as harmless only because it holds exactly two buttons.

**Files:**
- Create: `src/ui/Dialog.tsx`
- Modify: `src/ui/ConfirmDialog.tsx`
- Modify: `src/ui/ui.test.tsx` (add `Dialog` tests; `ConfirmDialog`'s existing tests must pass unchanged)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export interface DialogProps {
  /** Accessible name, already translated by the caller. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** `alertdialog` for a confirmation guarding a destructive action. */
  role?: 'dialog' | 'alertdialog';
  /** Classes for the panel, so a caller controls its own width. */
  className?: string;
}
export function Dialog(props: DialogProps): ReactElement;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/ui.test.tsx`:

```tsx
describe('Dialog', () => {
  it('is a modal dialog with the caller name', () => {
    render(
      <Dialog label="Appearance" onClose={vi.fn()}>
        <button type="button">One</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Appearance' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('takes alertdialog when the caller asks, since that is not cosmetic', () => {
    render(
      <Dialog label="Delete" role="alertdialog" onClose={vi.fn()}>
        <button type="button">One</button>
      </Dialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Dialog label="Appearance" onClose={onClose}>
        <button type="button">One</button>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open', async () => {
    render(
      <Dialog label="Appearance" onClose={vi.fn()}>
        <button type="button">One</button>
      </Dialog>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'One' })).toHaveFocus());
  });

  // The defect this extraction closes. `ConfirmDialog`'s trap queried
  // 'button' and its own comments call that a documented gap, harmless only
  // because it holds exactly two buttons. A trap that skips a focusable holds
  // it outside the modal instead of at its edge.
  it('traps Tab across non-button focusables', async () => {
    render(
      <Dialog label="Appearance" onClose={vi.fn()}>
        <a href="#one">Link</a>
        <button type="button">Two</button>
      </Dialog>,
    );
    const link = screen.getByRole('link', { name: 'Link' });
    const two = screen.getByRole('button', { name: 'Two' });

    await waitFor(() => expect(link).toHaveFocus());
    await userEvent.tab();
    expect(two).toHaveFocus();
    await userEvent.tab();
    expect(link).toHaveFocus();
  });

  it('restores focus to the opener on unmount', async () => {
    function Harness(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Dialog label="Appearance" onClose={() => setOpen(false)}>
              <button type="button">Inside</button>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: FAIL — `Dialog` is not exported.

- [ ] **Step 3: Implement `src/ui/Dialog.tsx`**

Model it on `ConfirmDialog.tsx`'s existing effects. Use the wide focusable selector — copy the constant and its reasoning from `Popover.tsx`:

```ts
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

Requirements, each pinned by a test above: a fixed full-viewport backdrop; a panel with `role` (default `'dialog'`), `aria-modal="true"` and `aria-label`; focus moved to the first focusable on mount; focus restored to `document.activeElement`-at-mount on unmount; Escape calling `onClose` with `stopPropagation`; Tab and Shift+Tab wrapping within the panel. Presentation only — it must import nothing from `src/app/`, `src/data/`, `src/features/` or `src/i18n/`.

- [ ] **Step 4: Rebuild `ConfirmDialog` on `Dialog`**

Keep `role="alertdialog"` and every existing prop and behaviour. Delete its own backdrop, Escape effect and focus trap — they now come from `Dialog`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: PASS, including every pre-existing `ConfirmDialog` test **unmodified**. If a `ConfirmDialog` test needs editing to pass, stop: that is a behaviour change, not a stale expectation.

- [ ] **Step 6: Run every gate and commit**

```bash
npx vitest run && npx tsc -b && npm run lint && npx prettier --check . && npm run build
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
git add src/ui/Dialog.tsx src/ui/ConfirmDialog.tsx src/ui/ui.test.tsx
git commit -m "refactor(ui): extract Dialog, closing ConfirmDialog's focus-trap gap"
```

---

### Task 7: Replace the picker list with a card grid

**Files:**
- Create: `src/features/appearance/ThemeDialog.tsx`
- Modify: `src/features/appearance/ThemePicker.tsx`
- Modify: `src/features/appearance/ThemePicker.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `Dialog` from Task 6; `THEMES`, `ThemeId` from Task 5; `useTheme()` returning `{ choice: ThemeChoice; setChoice: (next: ThemeChoice) => void }` from `src/app/useTheme`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the two new strings**

`en.ts`: `'appearance.sample': 'The quick brown fox jumps over the lazy dog.'`
`ko.ts`: `'appearance.sample': '다람쥐 헌 쳇바퀴에 타고파.'`

A pangram in each locale, so a card previews real letterforms rather than Lorem ipsum the user cannot read.

- [ ] **Step 2: Write the failing tests**

```tsx
it('shows every theme in the roster as a card', async () => {
  renderWithI18n(<ThemePicker />);
  await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));

  const group = screen.getByRole('radiogroup', { name: 'Appearance' });
  // System plus every roster entry.
  expect(within(group).getAllByRole('radio')).toHaveLength(THEMES.length + 1);
});

it('marks the current choice and no other', async () => {
  renderWithI18n(<ThemePicker />);
  await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
  await userEvent.click(screen.getByRole('radio', { name: /Dracula/ }));

  await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));
  const checked = screen
    .getAllByRole('radio')
    .filter((el) => el.getAttribute('aria-checked') === 'true');
  expect(checked).toHaveLength(1);
  expect(checked[0]).toHaveAccessibleName(expect.stringContaining('Dracula'));
});

// The trick this whole component rests on: a card paints itself by being
// rendered inside its own `data-theme`, so no colour ever enters TypeScript.
// System deliberately carries no attribute, inheriting whatever the document
// currently shows — which is exactly what choosing System means.
it('paints each card in its own theme, and System in none', async () => {
  renderWithI18n(<ThemePicker />);
  await userEvent.click(screen.getByRole('button', { name: 'Change theme' }));

  expect(screen.getByRole('radio', { name: /Nord/ })).toHaveAttribute('data-theme', 'nord');
  expect(screen.getByRole('radio', { name: /System/ })).not.toHaveAttribute('data-theme');
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run src/features/appearance`
Expected: FAIL — no `radiogroup`, the picker still renders a menu.

- [ ] **Step 4: Implement `ThemeDialog` and rewire `ThemePicker`**

`ThemeDialog` renders `<Dialog label={t('appearance.label')}>` containing a `role="radiogroup"` with a `max-h-[70vh] overflow-y-auto` two-column grid (`grid-cols-2 gap-3`), one `role="radio"` button per entry. Each card carries `data-theme={id}` (omitted for System), `aria-checked`, and paints itself with `bg-bg text-text border-border`, showing the theme name at `text-ui-md` and `t('appearance.sample')` at `text-ui-sm text-muted`, with one `text-accent` run. Selecting calls `setChoice` and closes.

`ThemePicker` keeps its footer trigger, its `Palette` glyph and its `appearance.open` label; it renders `ThemeDialog` when open instead of `Popover`. Delete the now-unused `row()` helper and the `GROUPS` constant if the grid does not group — but keep the light/dark split as two labelled `role="group"` sections inside the radiogroup if it reads better; decide by looking at it in Step 6.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/appearance`
Expected: PASS.

- [ ] **Step 6: Look at it, at two pane widths**

```bash
npm run dev
```
Open the picker. Confirm: sixteen cards plus System, each visibly its own palette; the grid scrolls rather than the page; Escape closes and focus returns to the trigger; Tab cycles inside the dialog. Drag the sidebar narrow and confirm the dialog is unaffected — it is modal and centred, so pane width must not reach it.

- [ ] **Step 7: Run every gate and commit**

```bash
npx vitest run && npx tsc -b && npm run lint && npx prettier --check . && npm run build
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
git add src/features/appearance src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(appearance): a card grid picker for sixteen themes"
```

---

### Task 8: Update the shots harness, docs and rulings

**Files:**
- Modify: `e2e/shots.spec.ts` (theme loop), `CLAUDE.md`, `docs/rulings/design-tokens-and-layout.md`, `docs/superpowers/NEXT.md`

- [ ] **Step 1: Check the shots harness survived the roster growth**

`e2e/shots.spec.ts:42` already derives its theme list from `themes.ts` by
regex, so it grows on its own — but the regex is
`/id: '([a-z-]+)', labelKey: '[^']+', group: '(light|dark)'/g` and requires
all three properties **on one line in that order**. Prettier reflowing a
longer entry onto multiple lines would make it silently match nothing, and an
empty theme list means the shots run produces the default theme sixteen times
with no error.

Run: `npm run shots` and count the output.

Expected: 192 files in `docs/design/shots/` (12 × 16). If you get 12, the
regex stopped matching — fix by widening it to tolerate newlines, not by
reformatting `themes.ts`.

- [ ] **Step 2: Update `CLAUDE.md`**

- Status table: add a row `| F theme system: derivation, 16 themes, card picker | complete |`.
- The shots bullet: `12 shots × 5 themes = 60 files` becomes `12 shots × 16 themes = 192 files`, and note it now takes roughly three times as long.
- Test counts: run `npx vitest run --project=app`, `--project=server` and `npx playwright test --list` and write the real numbers.
- Add a toolchain-surprises bullet:

```markdown
- **A derived token computes to `color(srgb …)`, and `parseColour` was
  silently blind to it.** Its fallback stripped an `rgb(` prefix that is not
  there and produced `NaN` — and the contrast harness's `ratio < min` test is
  FALSE for `NaN`, so an unreadable theme would have passed. Fixed in F with
  its own unit tests. Any future colour function (`lab()`, `oklch()`) reaching
  a computed value needs the same treatment, and the failure mode is silence.
```

- [ ] **Step 3: Add the rulings**

To `docs/rulings/design-tokens-and-layout.md`, extend the `**Trigger:**` line with `src/ui/Dialog.tsx`, `src/features/appearance/ThemeDialog.tsx` and `--bear-dark`, then add:

```markdown
- **Derivation provides DEFAULTS for new themes; it does not reconstruct the
  five that shipped before F, and measurement is why.** `muted`, `faint` and
  `border` look like `text` mixed toward `bg` — their lightness fits a
  constant ratio in both sRGB and oklab — but their CHROMA does not.
  `indigo-dark`'s `muted` is `(169, 163, 189)`, visibly violet, where the
  fitted mix gives a near-grey `(165, 162, 173)`. No single ratio reproduces
  all four themes; the best fit is off by up to 17/255 per channel. The five
  shipped themes therefore keep every hand-tuned value explicitly, and
  `e2e/themeBaseline.spec.ts` pins them against a fixture captured before
  derivation landed.

- **`--bear-dark` is a NUMBER (0 or 1), not a keyword, and it is not
  `themes.ts`'s `group`.** It is a number so `calc()` can interpolate the five
  alpha scalars from one declaration instead of five. It is separate from
  `group` because `group` decides how the PICKER files a theme and is
  deliberately hand-declared — `high-contrast` is dark by intent, and deriving
  the grouping would make it a side effect of a colour edit. A theme wanting
  something between the two schemes may say `0.5`, which no grouped selector
  could express.

- **Two colour spaces, and nothing enforces the split.** `oklab` for opaque
  mixes, because perceptual evenness is the only reason one ratio serves
  sixteen palettes. `srgb` for alpha tints, because mixing with `transparent`
  in `oklab` interpolates through a premultiplied space and shifts hue as it
  fades. A token added in the wrong space compiles, renders, and looks subtly
  wrong in a way no test can see.
```

- [ ] **Step 4: Update `NEXT.md`** — mark F shipped with its spec and plan paths, and record anything that diverged during execution.

- [ ] **Step 5: Run every gate and commit**

```bash
npx vitest run && npx tsc -b && npm run lint && npx prettier --check . && npm run build
lsof -ti:4173 | xargs -r kill -9 && npx playwright test --reporter=line
git add -A && git commit -m "docs(f): record the theme system's rulings and counts"
```

---

## Self-Review

**Spec coverage.** Derivation → Task 3. Contrast parser → Task 1. Roster of sixteen → Tasks 4–5. Card grid picker → Tasks 6–7. `Dialog` primitive and the `ConfirmDialog` gap → Task 6. sourceLint reshape → Task 3. Baseline regression test → Task 2. Shots count, CLAUDE.md, rulings → Task 8. Attribution comments → Tasks 4–5. Out-of-scope items (custom-theme editor, syntax palettes, theme sync, boot path) have no tasks, correctly.

**Known gap, stated rather than hidden.** The spec's "eleven contrast tests added" and the flake warning are covered by Tasks 4, 5 and the Global Constraints, but no task *reduces* e2e flakiness. F adds eleven contrast tests to a suite where E's five additions already tipped three pre-existing races. If new intermittent failures appear, they are to be read as real races and fixed in place, not retried away.

**Type consistency.** `ThemeId` grows in Tasks 4 and 5 only. `parseColour`/`Rgba` from Task 1 are used in Task 2. `DialogProps` from Task 6 is consumed in Task 7. `--bear-dark` is introduced in Task 3 and declared by every theme in Tasks 3–5. `blockTokens`, `REQUIRED` and `ids` in Task 3 are existing identifiers in `scripts/sourceLint.test.ts`.
