# Q — Typography settings: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reader five live, per-device controls over the prose — font size, line height, line width, paragraph spacing, paragraph indent — applied before first paint and carried into every export.

**Architecture:** A `src/app/typography.ts` model (guard, defaults, bounds, applier, `localStorage` mirror) that is the direct analogue of `src/app/theme.ts`; a `useTypography` hook shaped like `useTheme` because both need a paint-time mirror; a modal panel of five native range inputs that writes the DOM imperatively on every tick and the durable row on a trailing debounce. The export needs no new plumbing — `readExportTokens` already forwards all five tokens — but two pre-existing editor/export divergences are closed so they do not widen once the reader controls the type.

**Tech Stack:** React 19, TypeScript (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`), Tailwind v4, Dexie, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-q-typography-settings-design.md`

## Global Constraints

- **No user-facing string is hardcoded in a component.** Every string goes through `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error. Never weaken that annotation.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **`src/ui/` imports nothing from `src/app/`, `src/data/` or `src/i18n/`.** Enforced by `scripts/sourceLint.test.ts`. The panel therefore lives in `src/features/typography/`, not in `src/ui/`.
- **`lucide-react` may be imported only by `src/ui/Icon.tsx`.** A feature needing a glyph adds a re-export there.
- **Express "not this utility" as a prop that omits the class, never as an overriding utility.** Class-attribute order does not decide the cascade; stylesheet order does.
- **A component defined inside a render body is a new type every render.** Module scope, always.
- **Tailwind v4 silently emits nothing for a utility whose theme key is absent** — no warning, no error. Any new utility must be confirmed present in the compiled CSS.
- **CSS comments ship** — in the eager chunk AND in every exported file. Reasoning for export CSS goes in `docs/rulings/export.md`, not in the stylesheet.
- **Duck-type in tests; never `instanceof`.** `vitest.setup.ts` swaps the global `Blob`.
- **Check exit codes, not pass counts** when reviewing editor/DOM tests — an unstubbed API throws uncaught and `vitest run` exits 1 with every assertion passing.
- **Before any e2e run that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is silently reused and the suite then tests an old build.
- **Machine budget.** This is a fanless Mac Mini that also hosts the API service. Repetition targets FILES, never the suite: `npx vitest run <path>` is ~2-3s against ~80 CPU-seconds for the full run. Cap workers when shared: `npm test -- --run --maxWorkers=4`. Full suite only at the gate boundary in Task 9. Never generate synthetic load. If `uptime` load exceeds 20, stop and report.
- **Six gates before any commit is considered final:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`. Per-task commits run the cheap tier (`typecheck`, `lint`, `format`) plus the task's own scoped tests; Task 9 runs everything.
- **A seventh gate, because this sub-project is visual:** `npm run measure:check`. It must pass **UNCHANGED** — Q's defaults are today's token values, so no measured surface may move. A diff there means a reading preference leaked into the app chrome.
- **The controller merges this branch.** Commit on `q-typography-settings`; do not touch `main`, and do not merge your own work. A merge you did not perform was performed by the controller.

### The values, fixed once here

| Field | Token | Range | Step | Default |
| --- | --- | --- | --- | --- |
| `fontSize` | `--bear-font-size` | 13–22 | 1 | 16 (px) |
| `lineHeight` | `--bear-line-height` | 1.3–2 | 0.05 | 1.6 (unitless) |
| `lineWidth` | `--bear-line-width` | 30–70 | 2 | 40 (em) |
| `paraSpacing` | `--bear-para-spacing` | 0–1.5 | 0.25 | 0 (em) |
| `paraIndent` | `--bear-para-indent` | 0–3 | 0.5 | 0 (em) |

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/app/typography.ts` | **new.** The model: `Typography`, `BOUNDS`, `DEFAULTS`, `isTypography`, `typographyProperties`, `applyTypography`, mirror read/write, the two storage keys. No React. The analogue of `theme.ts`. |
| `src/app/typography.test.ts` | **new.** Unit tests for the above. |
| `src/app/useTypography.ts` | **new.** The hook: seeds from the mirror, applies on boot, heals a missing durable row, exposes `set` and `reset`. The analogue of `useTheme.ts`. |
| `src/app/useTypography.test.tsx` | **new.** |
| `src/features/typography/TypographyPanel.tsx` | **new.** The modal: five ranges, readouts, Reset, Done. |
| `src/features/typography/TypographyPanel.test.tsx` | **new.** |
| `src/features/typography/TypographyButton.tsx` | **new.** The sidebar-footer trigger that owns the open/closed state. |
| `src/features/typography/index.ts` | **new.** Feature barrel. |
| `src/app/SidebarContent.tsx:65-68` | Mount the trigger beside `ThemePicker`. |
| `index.html:43-71` | Extend the pre-paint inline script. |
| `src/ui/Icon.tsx:257-313` | Re-export one glyph. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | 11 keys. |
| `src/i18n/i18n.test.tsx:55-60` | Two entries in `ALLOWED_IDENTICAL`. |
| `src/features/export/html.ts` | Two tokens into `EXPORT_TOKEN_NAMES` + `FALLBACKS`; derived heading sizes; the title-line treatment. |
| `scripts/sourceLint.test.ts` | A `describe` for the typography half of the pre-paint script. |
| `scripts/bundleSize.test.ts:341` | The ceiling raise, with its reasoning in the docblock. |
| `e2e/typography.spec.ts` | **new.** Persistence, no-flash, export parity. |
| `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/export.md`, `docs/rulings/accessibility.md` | The rulings Q creates. |
| `docs/superpowers/NEXT.md` | Correct the `themes-*` row; add Q's row. |

---

### Task 1: The ceiling raise, and the `themes-*` correction

No feature code. This lands first so every later task's build is measured against the ceiling it will actually ship under.

**Files:**
- Modify: `scripts/bundleSize.test.ts:341` and its docblock
- Modify: `docs/superpowers/NEXT.md` (the two rows at lines 41 and 40)

**Interfaces:**
- Consumes: nothing.
- Produces: `CEILING_BYTES = 351_000`.

**Read first:** `docs/rulings/testing-and-tooling.md` (the bundle-ceiling ruling).

- [ ] **Step 1: Confirm the starting number rather than trusting the spec**

```bash
npm run build >/dev/null 2>&1
npx vitest run scripts/bundleSize.test.ts
node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
const m=JSON.parse(fs.readFileSync("dist/.vite/manifest.json","utf8"));
const ek=Object.keys(m).find(k=>m[k].isEntry);
const seen=new Set();(function w(k){if(seen.has(k))return;seen.add(k);for(const i of (m[k].imports||[]))w(i);})(ek);
let t=0;for(const k of seen){const b=zlib.gzipSync(fs.readFileSync(path.join("dist",m[k].file))).length;t+=b;console.log(String(b).padStart(8),m[k].file);}
console.log("TOTAL",t);
'
```

Expected: `TOTAL` within a few hundred bytes of **347,854**. The spec's own byte figures were measured at `349c9f6`; this file's standing rule is that a recorded number is never diffed against a fresh one. Record what you actually saw — it is the "before" side of Task 9's both-sides measurement.

- [ ] **Step 2: Raise the ceiling**

In `scripts/bundleSize.test.ts`, change line 341:

```ts
const CEILING_BYTES = 351_000;
```

- [ ] **Step 3: Append the reasoning to the docblock**

Immediately before the closing `*/` of the docblock, add:

```
 * ### Q (typography settings): the ceiling moves to 351,000, decided by the
 * user on 2026-09-03
 *
 * `main` (`349c9f6`) measures **347,854 B** — **146 B** under the frozen
 * 348,000 ceiling. Q does not fit in 146 B under any shape, so the freeze's
 * four exits were each tested rather than argued:
 *
 * **Going lazier is NEGATIVE here, measured.** `ThemeDialog` is a static
 * import gated on `open`, so a typography dialog written the same way is
 * fully eager. Converting `ThemeDialog` itself to `React.lazy` and
 * rebuilding took the eager closure from 347,854 B to **348,176 B** — 4
 * eager chunks became 6, and the re-hoisted shared runtime cost **322 B
 * more** than the entire dialog being deferred saved. This reproduces the
 * effect the M entry above measured from the other direction; a FOURTH lazy
 * root is a cost, not an escape hatch.
 *
 * **`themes-*` is not the theme code, and the chunk names are arbitrary.**
 * `NEXT.md` recorded `themes-*` (232,910 B at the M entry, 233,998 B here) as
 * "the obvious candidate" for a lazy split. That reads a filename. In the
 * spike build above — which changed one import and nothing else — the same
 * ~234 KB chunk came back named `notes-*` while a NEW 1,049 B chunk took the
 * name `themes-*`. The 1,049 B is the theme roster plus its dialog; the
 * 234 KB is Tiptap, ProseMirror, React and lowlight wearing the name.
 * Splitting "themes" out would reclaim ~1,049 B and pay ~322 B of
 * re-chunking, and the measurement above shows the re-chunking wins: the
 * split nets about **-322 B**. It is a regression, not a sub-project.
 *
 * **The server is not an option** — this is a per-device reading preference,
 * and the sync engine deliberately does not carry the `settings` table.
 * **Cutting it** means not fixing the reported problem.
 *
 * So `CEILING_BYTES` moves to **351,000**, decided BY THE USER on
 * 2026-09-03, leaving Q **3,146 B**. The ceiling remains FROZEN under the
 * same rule as every raise before it: this does not reopen routine
 * ratcheting. **If Q's finished closure lands well under 351,000, this
 * number comes DOWN to the measured figure plus ~3 KB rather than staying at
 * the ask** — that is the condition the raise was granted on.
 *
 * As always: re-run `npx vitest run scripts/bundleSize.test.ts` after a build
 * rather than reasoning from any number above.
```

- [ ] **Step 4: Verify the guard still passes, and that it can still fail**

```bash
npx vitest run scripts/bundleSize.test.ts
```

Expected: PASS.

Now injure it — a guard nobody has seen fail is not a guard:

```bash
sed -i '' 's/const CEILING_BYTES = 351_000;/const CEILING_BYTES = 100_000;/' scripts/bundleSize.test.ts
npx vitest run scripts/bundleSize.test.ts
```

Expected: FAIL, naming the real total and the breakdown. Then restore `351_000` and re-run to confirm PASS.

- [ ] **Step 5: Correct `NEXT.md`**

Replace the "The bundle ceiling is spent: **146 B** of headroom" row's cell with text recording: the ceiling is **351,000** as of 2026-09-03 by user decision; a fourth `React.lazy` root measured **+322 B**; and `themes-*` is a misread filename — chunk names are not stable, the 234 KB chunk is the editor/framework closure, and the split nets about **-322 B**. Do not leave the old "obvious candidate" sentence anywhere in the file.

Update the **Q typography settings** row to say the spec and plan exist, with their paths.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add scripts/bundleSize.test.ts docs/superpowers/NEXT.md
git commit -m "chore(q): raise the bundle ceiling to 351,000, and correct the themes-* row"
```

---

### Task 2: `src/app/typography.ts` — the model

**Files:**
- Create: `src/app/typography.ts`
- Test: `src/app/typography.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Typography { fontSize: number; lineHeight: number; lineWidth: number; paraSpacing: number; paraIndent: number }`
  - `const TYPOGRAPHY_KEY = 'typography'`, `const TYPOGRAPHY_MIRROR_KEY = 'bear-web:typography'`
  - `const BOUNDS: Record<keyof Typography, { min: number; max: number; step: number }>`
  - `const DEFAULTS: Typography`
  - `function isTypography(value: unknown): value is Typography`
  - `function snapField(field: keyof Typography, raw: number): number`
  - `function typographyProperties(value: Typography): Record<string, string>`
  - `function applyTypography(value: Typography, root?: HTMLElement): void`
  - `function readTypographyMirror(): Typography`
  - `function writeTypographyMirror(value: Typography): void`

**Read first:** `docs/rulings/design-tokens-and-layout.md`.

- [ ] **Step 1: Write the failing test**

Create `src/app/typography.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyTypography,
  BOUNDS,
  DEFAULTS,
  isTypography,
  readTypographyMirror,
  snapField,
  TYPOGRAPHY_MIRROR_KEY,
  typographyProperties,
  writeTypographyMirror,
} from './typography';

describe('DEFAULTS', () => {
  /*
   * The whole no-regression argument for Q rests on this: the defaults are
   * today's token values, so `measure:check` must pass unchanged. If someone
   * "improves" a default here, that gate fails and the reason will not be
   * obvious from its diff — so it is asserted where the change would be made.
   */
  it('are the values tokens.css already ships', () => {
    expect(DEFAULTS).toEqual({
      fontSize: 16,
      lineHeight: 1.6,
      lineWidth: 40,
      paraSpacing: 0,
      paraIndent: 0,
    });
  });

  it('are themselves valid', () => {
    expect(isTypography(DEFAULTS)).toBe(true);
  });
});

describe('isTypography', () => {
  it('rejects a non-object', () => {
    expect(isTypography(null)).toBe(false);
    expect(isTypography(undefined)).toBe(false);
    expect(isTypography(16)).toBe(false);
    expect(isTypography('16px')).toBe(false);
  });

  it('rejects a row missing a field', () => {
    const { paraIndent: _dropped, ...partial } = DEFAULTS;
    expect(isTypography(partial)).toBe(false);
  });

  it('rejects a non-numeric field', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: '16' })).toBe(false);
  });

  /*
   * NaN is the case that matters most and the one a `typeof === 'number'`
   * check alone lets through. `--bear-font-size: NaNpx` renders an unreadable
   * note with no error anywhere — the same silent shape as `parseColour`'s
   * NaN and an unmapped `.hljs-*` class.
   */
  it('rejects NaN and Infinity', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: Number.NaN })).toBe(false);
    expect(isTypography({ ...DEFAULTS, lineHeight: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects a value outside its bound in either direction', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: BOUNDS.fontSize.min - 1 })).toBe(false);
    expect(isTypography({ ...DEFAULTS, fontSize: BOUNDS.fontSize.max + 1 })).toBe(false);
    expect(isTypography({ ...DEFAULTS, lineWidth: 0 })).toBe(false);
  });

  it('accepts each bound exactly', () => {
    for (const field of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
      expect(isTypography({ ...DEFAULTS, [field]: BOUNDS[field].min })).toBe(true);
      expect(isTypography({ ...DEFAULTS, [field]: BOUNDS[field].max })).toBe(true);
    }
  });

  // A row written by a future version must degrade, not reach a consumer.
  it('accepts a row carrying an unknown extra field', () => {
    expect(isTypography({ ...DEFAULTS, headingRatio: 1.2 })).toBe(true);
  });
});

describe('snapField', () => {
  /*
   * A range input's value is a string the browser computed as min + step*n,
   * and float arithmetic there produces things like 1.6500000000000001. That
   * reaches CSS as a token value and reaches the readout as visible noise.
   */
  it('snaps to the step and kills float dust', () => {
    expect(snapField('lineHeight', 1.6500000000000001)).toBe(1.65);
    expect(snapField('paraSpacing', 0.7499999999)).toBe(0.75);
    expect(snapField('fontSize', 16.4)).toBe(16);
  });

  it('clamps to the bounds', () => {
    expect(snapField('fontSize', 99)).toBe(BOUNDS.fontSize.max);
    expect(snapField('fontSize', -5)).toBe(BOUNDS.fontSize.min);
  });

  it('returns the field default for a value that is not a number', () => {
    expect(snapField('fontSize', Number.NaN)).toBe(DEFAULTS.fontSize);
  });
});

describe('typographyProperties', () => {
  it('carries the unit each consumer expects', () => {
    expect(typographyProperties(DEFAULTS)).toEqual({
      '--bear-font-size': '16px',
      '--bear-line-height': '1.6',
      '--bear-line-width': '40em',
      '--bear-para-spacing': '0em',
      '--bear-para-indent': '0em',
    });
  });

  // `line-height` is the one that is unitless, and `1.6em` would compound
  // against the font size on every nested block.
  it('leaves line height unitless', () => {
    expect(typographyProperties(DEFAULTS)['--bear-line-height']).toBe('1.6');
  });
});

describe('applyTypography', () => {
  it('writes exactly the five properties, and no others', () => {
    const root = document.createElement('div');
    applyTypography({ ...DEFAULTS, fontSize: 20 }, root);
    expect(root.style.getPropertyValue('--bear-font-size')).toBe('20px');
    expect(root.style.length).toBe(5);
  });
});

describe('the mirror', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips', () => {
    const value = { ...DEFAULTS, fontSize: 19, lineWidth: 52 };
    writeTypographyMirror(value);
    expect(readTypographyMirror()).toEqual(value);
  });

  it('degrades to the defaults when absent', () => {
    expect(readTypographyMirror()).toEqual(DEFAULTS);
  });

  // A mirror edited by hand in devtools, or left by an older build.
  it('degrades to the defaults on unparseable or invalid content', () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, 'not json');
    expect(readTypographyMirror()).toEqual(DEFAULTS);
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ fontSize: 999 }));
    expect(readTypographyMirror()).toEqual(DEFAULTS);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run src/app/typography.test.ts`
Expected: FAIL — `Failed to resolve import "./typography"`. Not a single assertion failure; the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/typography.ts`:

```ts
/**
 * The reader's typography preference: the model, its guard, and its
 * paint-time mirror. The direct analogue of `theme.ts`, and deliberately
 * free of React so the pre-paint path and the hook can share it.
 */
export interface Typography {
  /** px. */
  fontSize: number;
  /** Unitless, so it does not compound against the font size. */
  lineHeight: number;
  /** em. */
  lineWidth: number;
  /** em, ADDITIONAL to the block rhythm — Bear's own semantics. */
  paraSpacing: number;
  /** em. */
  paraIndent: number;
}

/** The durable record's key in the settings table. */
export const TYPOGRAPHY_KEY = 'typography';

/**
 * The paint-time cache's key. Namespaced for the same reason the theme's is:
 * `localStorage` is origin-wide and this app shares an origin with everything
 * else on github.io.
 */
export const TYPOGRAPHY_MIRROR_KEY = 'bear-web:typography';

export interface Bound {
  min: number;
  max: number;
  step: number;
}

/**
 * The ranges, chosen rather than measured, and each with a reason.
 *
 * `fontSize` floors at 13 because the app chrome is 14px and prose smaller
 * than its own furniture reads as broken; it stops at 22 because above that
 * the default measure exceeds a typical pane, `editor.css`'s clamp takes
 * over, and the control appears to stop working.
 *
 * `lineWidth` extends well past the default 40em ON PURPOSE. 40em was
 * measured off the real Bear during M8, and it is the number the "the content
 * area looks cramp" report is about: at 16px it is a 640px column inside an
 * 840px pane. `editor.css`'s `min(var(--bear-line-width), 100% - 3rem)` makes
 * a wide setting degrade rather than overflow on a narrow pane or a phone.
 *
 * These bounds are DUPLICATED in `index.html`'s pre-paint script, which
 * cannot import them — a module import is async and would defeat the point,
 * exactly as the theme roster is duplicated there. `scripts/sourceLint.test.ts`
 * asserts the two agree.
 */
export const BOUNDS: Record<keyof Typography, Bound> = {
  fontSize: { min: 13, max: 22, step: 1 },
  lineHeight: { min: 1.3, max: 2, step: 0.05 },
  lineWidth: { min: 30, max: 70, step: 2 },
  paraSpacing: { min: 0, max: 1.5, step: 0.25 },
  paraIndent: { min: 0, max: 3, step: 0.5 },
};

/**
 * Every default is the value `tokens.css` already ships, so a fresh install
 * renders exactly as it did before Q — which is what lets `measure:check`
 * stay a regression test rather than needing a new baseline.
 */
export const DEFAULTS: Typography = {
  fontSize: 16,
  lineHeight: 1.6,
  lineWidth: 40,
  paraSpacing: 0,
  paraIndent: 0,
};

const FIELDS = Object.keys(BOUNDS) as (keyof Typography)[];

/**
 * Runs on every read, for the reason `useSetting`'s docblock gives: a row
 * written by a future version, or edited by hand in devtools, must fall back
 * rather than reach a consumer that cannot handle it. Here the consumer is
 * CSS, where the failure is silent — `--bear-font-size: NaNpx` renders an
 * unreadable note and logs nothing.
 */
export function isTypography(value: unknown): value is Typography {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return FIELDS.every((field) => {
    const found = row[field];
    return (
      typeof found === 'number' &&
      Number.isFinite(found) &&
      found >= BOUNDS[field].min &&
      found <= BOUNDS[field].max
    );
  });
}

/**
 * Clamps to the bound and snaps to the step.
 *
 * A range input hands back min + step*n computed in floating point, which
 * yields values like 1.6500000000000001 — noise in the readout, and noise in
 * a token value.
 */
export function snapField(field: keyof Typography, raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULTS[field];
  const { min, max, step } = BOUNDS[field];
  const clamped = Math.min(max, Math.max(min, raw));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Number(snapped.toFixed(2));
}

/** The five custom properties, each in the unit its consumer expects. */
export function typographyProperties(value: Typography): Record<string, string> {
  return {
    '--bear-font-size': `${value.fontSize}px`,
    '--bear-line-height': String(value.lineHeight),
    '--bear-line-width': `${value.lineWidth}em`,
    '--bear-para-spacing': `${value.paraSpacing}em`,
    '--bear-para-indent': `${value.paraIndent}em`,
  };
}

export function applyTypography(
  value: Typography,
  root: HTMLElement = document.documentElement,
): void {
  for (const [name, property] of Object.entries(typographyProperties(value))) {
    root.style.setProperty(name, property);
  }
}

export function readTypographyMirror(): Typography {
  try {
    const stored = localStorage.getItem(TYPOGRAPHY_MIRROR_KEY);
    if (stored === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(stored);
    return isTypography(parsed) ? parsed : DEFAULTS;
  } catch {
    // Private-mode Safari and some embedded webviews throw on access rather
    // than returning null, and `JSON.parse` throws on a corrupt entry. A
    // reading preference must never break boot.
    return DEFAULTS;
  }
}

export function writeTypographyMirror(value: Typography): void {
  try {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify(value));
  } catch {
    // Ignored: the settings table is the source of truth. Losing the mirror
    // costs a reflow on the next launch, not the preference.
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/typography.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Injure the guard to prove the tests can fail**

```bash
# Drop the finiteness check.
sed -i '' 's/      Number.isFinite(found) &&//' src/app/typography.ts
npx vitest run src/app/typography.test.ts
```

Expected: FAIL on `rejects NaN and Infinity`. Restore the line (`git checkout -p` or re-add it) and re-run to PASS. If the injection does NOT fail the suite, the test is not testing what it claims — fix the test, not the implementation.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/typography.ts src/app/typography.test.ts
git commit -m "feat(q): the typography model, its guard and its paint-time mirror"
```

---

### Task 3: `useTypography`

**Files:**
- Create: `src/app/useTypography.ts`
- Test: `src/app/useTypography.test.tsx`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: `interface TypographyControl { value: Typography; set: (next: Typography) => void; reset: () => void }` and `function useTypography(): TypographyControl`.

**Read first:** `src/app/useTheme.ts` (the shape being followed) and `src/app/useSetting.ts`'s docblock (the shape being rejected, and why). `docs/rulings/notes-lifecycle.md` for the `useLiveQuery` deps rule.

- [ ] **Step 1: Write the failing test**

Create `src/app/useTypography.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';

import {
  DEFAULTS,
  TYPOGRAPHY_KEY,
  TYPOGRAPHY_MIRROR_KEY,
  type Typography,
} from './typography';
import { useTypography } from './useTypography';

function Probe(): React.ReactElement {
  const { value, set, reset } = useTypography();
  return (
    <div>
      <span data-testid="size">{value.fontSize}</span>
      <button type="button" onClick={() => set({ ...value, fontSize: 20 })}>
        bigger
      </button>
      <button type="button" onClick={reset}>
        reset
      </button>
    </div>
  );
}

const READ = () => Number(screen.getByTestId('size').textContent);

describe('useTypography', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    await settings.remove(TYPOGRAPHY_KEY);
  });

  it('renders the defaults when nothing is stored', async () => {
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
  });

  /*
   * The mirror already painted the first frame, so seeding the live query
   * from anything else would make the app disagree with itself until
   * IndexedDB answered. This is the reason this hook is shaped like
   * `useTheme` and not like `useSetting`.
   */
  it('seeds from the mirror rather than from the constant defaults', () => {
    const mirrored: Typography = { ...DEFAULTS, fontSize: 19 };
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify(mirrored));
    render(<Probe />);
    expect(READ()).toBe(19);
  });

  it('lets the durable row win over the mirror', async () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ ...DEFAULTS, fontSize: 19 }));
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21 });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(21));
  });

  it('falls back to the defaults when the durable row is malformed', async () => {
    await settings.set(TYPOGRAPHY_KEY, { fontSize: 'huge' });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
  });

  it('applies the value to documentElement', async () => {
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21 });
    render(<Probe />);
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bear-font-size')).toBe('21px'),
    );
  });

  /*
   * The repair `useTheme` does not do. If the durable row is absent but the
   * mirror holds a preference, nothing there ever writes the row back, so a
   * cache quietly becomes the source of truth and clearing site data loses
   * the preference with no other trace.
   */
  it('heals an absent durable row from the mirror', async () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ ...DEFAULTS, fontSize: 19 }));
    render(<Probe />);
    await waitFor(async () =>
      expect(await settings.get<unknown>(TYPOGRAPHY_KEY, null)).toEqual({
        ...DEFAULTS,
        fontSize: 19,
      }),
    );
  });

  it('writes the durable row, the mirror and the DOM on set', async () => {
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
    screen.getByRole('button', { name: 'bigger' }).click();

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bear-font-size')).toBe('20px'),
    );
    expect(JSON.parse(localStorage.getItem(TYPOGRAPHY_MIRROR_KEY) ?? '{}')).toMatchObject({
      fontSize: 20,
    });
    await waitFor(async () =>
      expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
        fontSize: 20,
      }),
    );
  });

  it('restores every field on reset', async () => {
    await settings.set(TYPOGRAPHY_KEY, { ...DEFAULTS, fontSize: 21, lineWidth: 60 });
    render(<Probe />);
    await waitFor(() => expect(READ()).toBe(21));

    screen.getByRole('button', { name: 'reset' }).click();

    await waitFor(() => expect(READ()).toBe(DEFAULTS.fontSize));
    expect(document.documentElement.style.getPropertyValue('--bear-line-width')).toBe('40em');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/useTypography.test.tsx`
Expected: FAIL — `Failed to resolve import "./useTypography"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/useTypography.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef } from 'react';

import { settings } from '@/data';

import {
  applyTypography,
  DEFAULTS,
  isTypography,
  readTypographyMirror,
  TYPOGRAPHY_KEY,
  type Typography,
  writeTypographyMirror,
} from './typography';

export interface TypographyControl {
  value: Typography;
  set: (next: Typography) => void;
  reset: () => void;
}

/**
 * The settings table is the source of truth; the mirror is a paint-time cache.
 *
 * Shaped like `useTheme` rather than like `useSetting`, and the reason is the
 * flash. `useSetting` renders at its fallback until IndexedDB answers — its
 * own docblock says "one frame at the default beats a blank pane", which is
 * right for a sort order and wrong for a font size, where that frame is the
 * whole note reflowing on every launch. Seeding the live query FROM THE
 * MIRROR is what stops the app disagreeing with the frame it already painted.
 *
 * `useFlushTriggers` is not needed here for the same reason `useTheme` does
 * not need it: the mirror is written synchronously, so a reload landing
 * between the change and the fire-and-forget durable write still reads the
 * user's value.
 *
 * Deps are the constant `[]`, so `useLiveQuery`'s documented
 * previous-deps-for-one-tick behaviour cannot apply.
 */
export function useTypography(): TypographyControl {
  const stored = useLiveQuery(
    () => settings.get<unknown>(TYPOGRAPHY_KEY, readTypographyMirror()),
    [],
    readTypographyMirror(),
  );

  // Referentially stable between live-query updates: either the stored object
  // itself, or the module constant. So the effect below does not re-run on
  // every render.
  const value = isTypography(stored) ? stored : DEFAULTS;

  /*
   * One repair `useTheme` does NOT make. If the durable row is absent while
   * the mirror holds a preference, `settings.get`'s fallback serves the
   * mirror and nothing ever writes the row — the cache silently becomes the
   * source of truth, and clearing site data loses the preference with no
   * other trace. Guarded by a ref so it is attempted once per mount rather
   * than on every value change.
   */
  const healed = useRef(false);

  useEffect(() => {
    applyTypography(value);
    writeTypographyMirror(value);

    if (healed.current) return;
    healed.current = true;
    void settings.get<unknown>(TYPOGRAPHY_KEY, null).then((row) => {
      if (row === null) void settings.set(TYPOGRAPHY_KEY, value);
    });
  }, [value]);

  const set = useCallback((next: Typography) => {
    // Optimistic, and deliberately so, exactly as `useTheme` is: the
    // properties and the mirror move now, the durable write follows. Waiting
    // on IndexedDB would leave a slider visibly lagging its own drag.
    applyTypography(next);
    writeTypographyMirror(next);
    void settings.set(TYPOGRAPHY_KEY, next);
  }, []);

  const reset = useCallback(() => set(DEFAULTS), [set]);

  return { value, set, reset };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/useTypography.test.tsx`
Expected: PASS.

- [ ] **Step 5: Injure it**

```bash
# Seed from the constant instead of the mirror — the exact defect the shape exists to prevent.
sed -i '' 's/    readTypographyMirror(),\n  );/    DEFAULTS,\n  );/' src/app/useTypography.ts
```

If `sed` does not match (it spans lines), make the edit by hand: change the third argument of `useLiveQuery` from `readTypographyMirror()` to `DEFAULTS`.

Run: `npx vitest run src/app/useTypography.test.tsx`
Expected: FAIL on `seeds from the mirror rather than from the constant defaults`. Restore and re-run.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/useTypography.ts src/app/useTypography.test.tsx
git commit -m "feat(q): useTypography, seeded from the mirror and healing an absent row"
```

---

### Task 4: The pre-paint inline script

**Files:**
- Modify: `index.html:43-71`
- Modify: `scripts/sourceLint.test.ts` (append a new `describe` after `describe('the pre-paint theme script', …)`)

**Interfaces:**
- Consumes: `TYPOGRAPHY_MIRROR_KEY` and `BOUNDS` from Task 2, by NAME only — the script cannot import them.
- Produces: nothing importable.

**Read first:** `scripts/sourceLint.test.ts:487-522`, the existing theme-script guard this mirrors.

- [ ] **Step 1: Write the failing guard**

Append to `scripts/sourceLint.test.ts`:

```ts
describe('the pre-paint typography script', () => {
  const html = readFileSync('index.html', 'utf8');
  const model = readFileSync('src/app/typography.ts', 'utf8');

  it('reads the same storage key the app writes', () => {
    const key = model.match(/TYPOGRAPHY_MIRROR_KEY = '([^']+)'/)![1]!;
    expect(html).toContain(`localStorage.getItem('${key}')`);
  });

  /*
   * The script cannot import `BOUNDS` — a module import is async, and the
   * whole point is to run before first paint. So the bounds are duplicated,
   * and this is what stops them drifting. Drift here is silent and nasty in
   * one direction specifically: bounds WIDER in the script than in the model
   * let a hand-edited mirror paint an unreadable first frame that the app
   * then silently corrects, which reads as a flash with no cause.
   */
  it('duplicates exactly the model bounds', () => {
    const declared = [...model.matchAll(/(\w+): \{ min: ([\d.]+), max: ([\d.]+), step: [\d.]+ \}/g)];
    expect(declared.length, 'no bounds parsed out of typography.ts').toBe(5);

    const script = html.match(/var bounds = \{([\s\S]*?)\};/)![1]!;
    for (const [, field, min, max] of declared) {
      expect(script, `${field} missing or wrong in the pre-paint script`).toContain(
        `${field}: [${min}, ${max}]`,
      );
    }
    expect([...script.matchAll(/\w+: \[/g)].length).toBe(5);
  });

  // It has to beat the module that renders the app, or it is decorative.
  it('runs before the app script', () => {
    expect(html.indexOf('bear-web:typography')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/sourceLint.test.ts -t 'pre-paint typography'`
Expected: FAIL on all three — `html` contains none of it yet.

- [ ] **Step 3: Extend the inline script**

In `index.html`, inside the existing `<script>` IIFE, after the theme block's closing `}` and before the `catch`, add the typography pass. The whole script becomes:

```html
    <script>
      (function () {
        try {
          var stored = localStorage.getItem('bear-web:theme');
          var known = [
            'indigo-light',
            'indigo-dark',
            'paper',
            'ink',
            'high-contrast',
            'solarized-light',
            'rose-dawn',
            'latte',
            'gruvbox-light',
            'snow',
            'sepia',
            'nord',
            'dracula',
            'solarized-dark',
            'tokyo-night',
            'gruvbox-dark',
          ];
          if (stored && known.indexOf(stored) !== -1) {
            document.documentElement.setAttribute('data-theme', stored);
          }
        } catch (error) {
          /* Storage unavailable; the media query decides. */
        }

        /*
          The reader's typography, for the same reason and by the same means as
          the theme above: IndexedDB is async and cannot paint the first frame,
          so without this every launch renders at 16px/40em and then reflows the
          whole note. Bounds are duplicated from `src/app/typography.ts` because
          a module import would be async; `scripts/sourceLint.test.ts` asserts
          the two agree.

          A separate try/catch, so a corrupt typography entry cannot cost the
          theme its no-flash behaviour, or the reverse.
        */
        try {
          var units = {
            fontSize: 'px',
            lineHeight: '',
            lineWidth: 'em',
            paraSpacing: 'em',
            paraIndent: 'em',
          };
          var props = {
            fontSize: '--bear-font-size',
            lineHeight: '--bear-line-height',
            lineWidth: '--bear-line-width',
            paraSpacing: '--bear-para-spacing',
            paraIndent: '--bear-para-indent',
          };
          var bounds = {
            fontSize: [13, 22],
            lineHeight: [1.3, 2],
            lineWidth: [30, 70],
            paraSpacing: [0, 1.5],
            paraIndent: [0, 3],
          };
          var type = JSON.parse(localStorage.getItem('bear-web:typography'));
          var valid = type !== null && typeof type === 'object';
          for (var field in bounds) {
            var n = valid ? type[field] : null;
            if (
              typeof n !== 'number' ||
              !isFinite(n) ||
              n < bounds[field][0] ||
              n > bounds[field][1]
            ) {
              valid = false;
            }
          }
          /* All five or none: a half-applied preference is a worse first frame
             than the default one. */
          if (valid) {
            for (var name in props) {
              document.documentElement.style.setProperty(
                props[name],
                String(type[name]) + units[name],
              );
            }
          }
        } catch (error) {
          /* Storage unavailable or the entry is corrupt; the tokens decide. */
        }
      })();
    </script>
```

- [ ] **Step 4: Run the guard**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: PASS, including the three new tests and every pre-existing one.

- [ ] **Step 5: Injure it**

```bash
sed -i '' 's/fontSize: \[13, 22\]/fontSize: [1, 99]/' index.html
npx vitest run scripts/sourceLint.test.ts -t 'duplicates exactly the model bounds'
```

Expected: FAIL, naming `fontSize`. Restore `[13, 22]` and re-run to PASS.

- [ ] **Step 6: Prove the script actually runs, by hand**

`npm run dev`, then in the browser console:

```js
localStorage.setItem('bear-web:typography', JSON.stringify({fontSize:21,lineHeight:1.9,lineWidth:60,paraSpacing:0.5,paraIndent:0}));
location.reload();
```

Expected: the note renders large and wide **immediately**, with no visible step from the default. Then set the entry to `'garbage'` and reload: the app renders at the defaults and logs nothing. `sourceLint` cannot see either of these — it reads text.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add index.html scripts/sourceLint.test.ts
git commit -m "feat(q): apply the reader's typography before first paint"
```

---

### Task 5: The panel

**Files:**
- Create: `src/features/typography/TypographyPanel.tsx`
- Test: `src/features/typography/TypographyPanel.test.tsx`
- Modify: `src/i18n/en.ts` (append before the closing `} as const;`), `src/i18n/ko.ts` (append before the closing `};`)
- Modify: `src/i18n/i18n.test.tsx:55-60`
- Modify: `src/ui/Icon.tsx:257-313`

**Interfaces:**
- Consumes: `BOUNDS`, `DEFAULTS`, `Typography`, `snapField`, `applyTypography` from Task 2.
- Produces: `interface TypographyPanelProps { value: Typography; onCommit: (next: Typography) => void; onDismiss: () => void }` and `function TypographyPanel(props): ReactElement`.

**Read first:** `docs/rulings/accessibility.md`, and `src/features/appearance/ThemeDialog.tsx` for the `Dialog` usage pattern.

- [ ] **Step 1: Add the glyph, and verify it exists before writing code that imports it**

```bash
ls node_modules/lucide-react/dist/esm/icons/ | grep -x 'type.js'
```

Expected: `type.js`. If it is absent, stop and report — do not substitute a guessed name. (A plan's icon names are exactly the kind of guess that has been wrong here before.)

In `src/ui/Icon.tsx`, add `Type as TypeGlyph,` to the `export { … } from 'lucide-react';` list, alphabetically irrelevant — append beside `Palette`. The alias follows `Table as TableGlyph`: a bare `Type` at a call site reads as the TypeScript keyword.

- [ ] **Step 2: Add the eleven i18n keys**

`src/i18n/en.ts`, before `} as const;`:

```ts
  'typography.open': 'Typography',
  'typography.label': 'Typography',
  'typography.fontSize': 'Font size',
  'typography.lineHeight': 'Line height',
  'typography.lineWidth': 'Line width',
  'typography.paraSpacing': 'Paragraph spacing',
  'typography.paraIndent': 'Paragraph indent',
  'typography.reset': 'Reset',
  'typography.done': 'Done',
  'typography.unit.px': 'px',
  'typography.unit.em': 'em',
```

`src/i18n/ko.ts`, before the closing `};`:

```ts
  'typography.open': '타이포그래피',
  'typography.label': '타이포그래피',
  'typography.fontSize': '글자 크기',
  'typography.lineHeight': '줄 간격',
  'typography.lineWidth': '본문 너비',
  'typography.paraSpacing': '문단 간격',
  'typography.paraIndent': '문단 들여쓰기',
  'typography.reset': '초기화',
  'typography.done': '완료',
  'typography.unit.px': 'px',
  'typography.unit.em': 'em',
```

`src/i18n/i18n.test.tsx`, in `ALLOWED_IDENTICAL`, add the two units and extend the comment above the list:

```ts
      'typography.unit.px',
      'typography.unit.em',
```

```
    // - `typography.unit.px` and `typography.unit.em` are CSS unit SYMBOLS.
    //   Korean writes them exactly as CSS does; there is nothing to translate.
```

- [ ] **Step 3: Write the failing test**

Create `src/features/typography/TypographyPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOUNDS, DEFAULTS, type Typography } from '@/app/typography';
import { I18nProvider } from '@/i18n';

import { TypographyPanel } from './TypographyPanel';

function setup(value: Typography = DEFAULTS) {
  const onCommit = vi.fn();
  const onDismiss = vi.fn();
  render(
    <I18nProvider>
      <TypographyPanel value={value} onCommit={onCommit} onDismiss={onDismiss} />
    </I18nProvider>,
  );
  return { onCommit, onDismiss };
}

const size = () => screen.getByRole('slider', { name: 'Font size' }) as HTMLInputElement;

describe('TypographyPanel', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    vi.useRealTimers();
  });

  it('renders one labelled slider per field, with its bounds', () => {
    setup();
    for (const [field, name] of [
      ['fontSize', 'Font size'],
      ['lineHeight', 'Line height'],
      ['lineWidth', 'Line width'],
      ['paraSpacing', 'Paragraph spacing'],
      ['paraIndent', 'Paragraph indent'],
    ] as const) {
      const slider = screen.getByRole('slider', { name }) as HTMLInputElement;
      expect(slider.min).toBe(String(BOUNDS[field].min));
      expect(slider.max).toBe(String(BOUNDS[field].max));
      expect(slider.step).toBe(String(BOUNDS[field].step));
    }
  });

  /*
   * The accessible name must be the label ALONE. The readout sits beside it,
   * and if it were inside the label every slider would announce as "Font size
   * 16 px" while also carrying the value in `aria-valuetext` — the same
   * concatenated-name defect this project has shipped three times
   * (`SidebarRow`'s lost space, `NoteListItem`'s three spans, `ThemeDialog`'s
   * sample text).
   */
  it('names each slider by its label alone, and carries the value in aria-valuetext', () => {
    setup();
    expect(size().getAttribute('aria-valuetext')).toBe('16 px');
    expect(
      screen.getByRole('slider', { name: 'Line height' }).getAttribute('aria-valuetext'),
    ).toBe('1.6');
  });

  it('writes the custom property on change, before any commit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();

    await userEvent.type(size(), '{arrowright}');

    expect(document.documentElement.style.getPropertyValue('--bear-font-size')).toBe('17px');
  });

  /*
   * A slider fires a change on every tick. Committing each one would write
   * IndexedDB and re-render AppShell thirty times during one drag.
   */
  it('commits once, on a trailing debounce, not per tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onCommit } = setup();

    await userEvent.type(size(), '{arrowright}{arrowright}{arrowright}');
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({ ...DEFAULTS, fontSize: 19 });
  });

  /*
   * The failure mode the debounce introduces, and the reason the cleanup
   * FLUSHES rather than cancels: a user who nudges a slider and immediately
   * closes the panel must not lose the change.
   */
  it('flushes a pending commit when it unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onCommit = vi.fn();
    const { unmount } = render(
      <I18nProvider>
        <TypographyPanel value={DEFAULTS} onCommit={onCommit} onDismiss={vi.fn()} />
      </I18nProvider>,
    );

    await userEvent.type(
      screen.getByRole('slider', { name: 'Font size' }),
      '{arrowright}',
    );
    unmount();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({ ...DEFAULTS, fontSize: 17 });
  });

  it('resets every field at once, without waiting for the debounce', async () => {
    const { onCommit } = setup({ fontSize: 21, lineHeight: 1.9, lineWidth: 60, paraSpacing: 0.5, paraIndent: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onCommit).toHaveBeenCalledWith(DEFAULTS);
    expect(size().value).toBe('16');
    expect(document.documentElement.style.getPropertyValue('--bear-line-width')).toBe('40em');
  });

  // A disabled control a user reaches for and cannot press explains nothing.
  it('leaves Reset enabled at the defaults', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Reset' })).not.toHaveProperty('disabled', true);
  });

  it('dismisses on Done and on Escape', async () => {
    const { onDismiss } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/features/typography/TypographyPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./TypographyPanel"`.

- [ ] **Step 5: Write the panel**

Create `src/features/typography/TypographyPanel.tsx`:

```tsx
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { applyTypography, BOUNDS, DEFAULTS, snapField, type Typography } from '@/app/typography';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

export interface TypographyPanelProps {
  value: Typography;
  /** The durable write. Debounced by this component; never called per tick. */
  onCommit: (next: Typography) => void;
  onDismiss: () => void;
}

interface Row {
  field: keyof Typography;
  labelKey: TranslationKey;
  /** `null` for line height, which is unitless. */
  unitKey: TranslationKey | null;
}

/*
 * Module scope, not the render body. A component or a constant array of JSX
 * defined inside a render is a new identity every render, which unmounts and
 * remounts its children — and this panel re-renders on every slider tick.
 */
const ROWS: readonly Row[] = [
  { field: 'fontSize', labelKey: 'typography.fontSize', unitKey: 'typography.unit.px' },
  { field: 'lineHeight', labelKey: 'typography.lineHeight', unitKey: null },
  { field: 'lineWidth', labelKey: 'typography.lineWidth', unitKey: 'typography.unit.em' },
  { field: 'paraSpacing', labelKey: 'typography.paraSpacing', unitKey: 'typography.unit.em' },
  { field: 'paraIndent', labelKey: 'typography.paraIndent', unitKey: 'typography.unit.em' },
];

const COMMIT_DELAY_MS = 250;

/**
 * The five reading controls.
 *
 * **This component owns the drag; React state above it does not.** A range
 * input fires a change on every tick, and routing each through the durable
 * write and its `useLiveQuery` would re-render the whole shell thirty times
 * during one gesture. So the in-flight value lives here, the custom property
 * is written to the document IMPERATIVELY on every tick — which is what makes
 * the preview live, since `editor.css` and the export stylesheet both already
 * read these tokens — and `onCommit` fires once on a trailing debounce.
 *
 * The debounce introduces exactly one failure mode, and the cleanup FLUSHES
 * rather than cancels because of it: a user who nudges a slider and closes the
 * panel inside 250 ms must not lose the change.
 */
export function TypographyPanel({
  value,
  onCommit,
  onDismiss,
}: TypographyPanelProps): ReactElement {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState<Typography>(value);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Typography | undefined>(undefined);

  // Read through a ref so the flush-on-unmount effect can have an empty
  // dependency list without closing over a stale callback.
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      if (pending.current !== undefined) commit.current(pending.current);
    },
    [],
  );

  function flush(next: Typography): void {
    if (timer.current !== undefined) clearTimeout(timer.current);
    pending.current = undefined;
    commit.current(next);
  }

  function change(field: keyof Typography, raw: number): void {
    const next = { ...draft, [field]: snapField(field, raw) };
    setDraft(next);
    applyTypography(next);

    pending.current = next;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = undefined;
      commit.current(next);
    }, COMMIT_DELAY_MS);
  }

  function reset(): void {
    setDraft(DEFAULTS);
    applyTypography(DEFAULTS);
    flush(DEFAULTS);
  }

  return (
    <Dialog
      open
      onClose={onDismiss}
      label={t('typography.label')}
      className="w-full max-w-sm gap-4 p-4"
    >
      <h2 className="text-ui-lg text-text font-semibold">{t('typography.label')}</h2>

      <div className="flex flex-col gap-3">
        {ROWS.map(({ field, labelKey, unitKey }) => {
          const bound = BOUNDS[field];
          const unit = unitKey === null ? '' : ` ${t(unitKey)}`;
          const readout = `${draft[field]}${unit}`;
          const control = `${id}-${field}`;

          return (
            <div key={field} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                {/*
                  The readout is a SIBLING of the label, never inside it: an
                  `<input>` labelled by an element that also holds its value
                  announces the value twice, once in the name and once in
                  `aria-valuetext`.
                */}
                <label htmlFor={control} className="text-ui text-text">
                  {t(labelKey)}
                </label>
                <span aria-hidden="true" className="text-ui-sm text-muted tabular-nums">
                  {readout}
                </span>
              </div>
              <input
                id={control}
                type="range"
                min={bound.min}
                max={bound.max}
                step={bound.step}
                value={draft[field]}
                aria-valuetext={readout}
                onChange={(event) => change(field, Number(event.target.value))}
                className="accent-accent w-full"
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between gap-2">
        <Button onClick={reset} variant="ghost">
          {t('typography.reset')}
        </Button>
        <Button onClick={onDismiss} variant="primary">
          {t('typography.done')}
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/typography/TypographyPanel.test.tsx src/i18n/i18n.test.tsx`
Expected: PASS.

- [ ] **Step 7: Confirm the one utility Tailwind can silently drop**

`accent-accent` is a new utility in this codebase. Tailwind v4 emits NOTHING for a utility whose theme key is absent — no build warning, no runtime error — which is how `hover:bg-hover` went two milestones without a hover state.

```bash
npm run build >/dev/null 2>&1
grep -o 'accent-color:[^;}]*' dist/assets/*.css | head
```

Expected: at least one `accent-color:` declaration. If there is none, the utility compiled to nothing — replace it with a plain `[accent-color:var(--color-accent)]` arbitrary value and re-check.

- [ ] **Step 8: Injure the accessible-name test**

Move the readout `<span>` inside the `<label>` and re-run. Expected: FAIL on `names each slider by its label alone` — the name becomes `Font size 16 px`. Restore.

- [ ] **Step 9: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/typography src/i18n src/ui/Icon.tsx
git commit -m "feat(q): the typography panel, five ranges on a trailing debounce"
```

---

### Task 6: The trigger, and mounting it

**Files:**
- Create: `src/features/typography/TypographyButton.tsx`
- Create: `src/features/typography/index.ts`
- Test: `src/features/typography/TypographyButton.test.tsx`
- Modify: `src/app/SidebarContent.tsx` (the import block, and the footer at lines 65-68)

**Interfaces:**
- Consumes: `TypographyPanel` from Task 5, `useTypography` from Task 3, `TypeGlyph` from Task 5's Icon change.
- Produces: `function TypographyButton(): ReactElement`, re-exported from `src/features/typography/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/features/typography/TypographyButton.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { settings } from '@/data';
import { DEFAULTS, TYPOGRAPHY_KEY, type Typography } from '@/app/typography';
import { I18nProvider } from '@/i18n';

import { TypographyButton } from './TypographyButton';

function setup() {
  return render(
    <I18nProvider>
      <TypographyButton />
    </I18nProvider>,
  );
}

describe('TypographyButton', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    await settings.remove(TYPOGRAPHY_KEY);
  });

  it('labels its icon-only trigger', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Typography' })).toBeTruthy();
  });

  it('opens the panel and reports expansion', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Typography' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Typography' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Done', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Typography' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The whole loop: a slider move reaches the durable row through the hook.
  it('persists a change made in the panel', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Typography' }));
    await userEvent.type(screen.getByRole('slider', { name: 'Font size' }), '{arrowright}');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(async () =>
      expect(await settings.get<Typography>(TYPOGRAPHY_KEY, DEFAULTS)).toMatchObject({
        fontSize: 17,
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/typography/TypographyButton.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the trigger and the barrel**

Create `src/features/typography/TypographyButton.tsx`:

```tsx
import { type ReactElement, useState } from 'react';

import { useTypography } from '@/app/useTypography';
import { useT } from '@/i18n';
import { Icon, TypeGlyph } from '@/ui/Icon';

import { TypographyPanel } from './TypographyPanel';

/**
 * The sidebar-footer trigger, a sibling of `ThemePicker` in the same sense
 * `AccountMenu` is — a second small control in the same strip, not a new
 * chrome region.
 *
 * Modal rather than anchored, for the reason `ThemeDialog` records: the
 * sidebar `Pane` is `overflow-hidden`, so an anchored surface wider than the
 * pane is clipped by it.
 */
export function TypographyButton(): ReactElement {
  const t = useT();
  const { value, set } = useTypography();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('typography.open')}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={TypeGlyph} size="md" />
      </button>

      {open ? (
        <TypographyPanel value={value} onCommit={set} onDismiss={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
```

Create `src/features/typography/index.ts`:

```ts
export { TypographyButton } from './TypographyButton';
```

- [ ] **Step 4: Mount it**

In `src/app/SidebarContent.tsx`, add to the imports:

```tsx
import { TypographyButton } from '@/features/typography';
```

and change the footer to:

```tsx
      <div className="border-border flex shrink-0 items-center gap-1 border-t p-1">
        <ThemePicker />
        <TypographyButton />
        <AccountMenu />
      </div>
```

- [ ] **Step 5: Run the tests, including the shell's**

```bash
npx vitest run src/features/typography src/app
```

Expected: PASS. `AppShell.test.tsx` renders the sidebar, so a broken import surfaces here.

- [ ] **Step 6: Run the app**

`npm run dev`. Open the panel, drag every slider, watch the note reflow live, press Reset, close, reload. **This is not optional and no gate replaces it:** N shipped a circular import that passed all six gates and three code reviews and left the app rendering a blank page, and the only thing that caught it was opening the app.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/typography src/app/SidebarContent.tsx
git commit -m "feat(q): the sidebar-footer trigger for the typography panel"
```

---

### Task 7: Close the two editor/export divergences

**Files:**
- Modify: `src/features/export/html.ts` — `EXPORT_TOKEN_NAMES`, `FALLBACKS`, and the stylesheet's heading rules
- Test: `src/features/export/html.test.ts` (append; confirm the exact filename with `ls src/features/export/`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EXPORT_TOKEN_NAMES` gains `'--bear-heading-ratio'` and `'--bear-title-gap'`, which widens the `ExportTokenName` union.

**Read first:** `docs/rulings/export.md` in full. Its trigger list names `html.ts`, `EXPORT_TOKEN_NAMES` and `FALLBACKS` explicitly.

**Why this is in Q at all.** `NEXT.md` records the export's heading sizes as "literals where the editor derives them". Measured, they are also the WRONG literals: the export ships `1.6em / 1.35em / 1.15em`, which `tokens.css:137`'s comment names as *"the previous"* scale, replaced during M9a by `--bear-heading-ratio: 1.2` and the editor's derived `1.728 / 1.44 / 1.2`. The export also has no title-line treatment where the editor gives a note's first block the accent, 700 weight and a `--bear-title-gap` separator. Both are invisible today and both get worse the moment the reader controls the type.

- [ ] **Step 1: Write the failing test**

Append to the export's test file:

```ts
describe('the export mirrors the editor typography', () => {
  /*
   * These two joined EXPORT_TOKEN_NAMES during Q. Before that the export's
   * heading sizes were the PRE-M9a literals 1.6/1.35/1.15em against the
   * editor's derived 1.728/1.44/1.2 — a divergence nothing compared, and one
   * that becomes visible the moment the reader controls the font size.
   */
  it('forwards the heading ratio and the title gap', () => {
    expect(EXPORT_TOKEN_NAMES).toContain('--bear-heading-ratio');
    expect(EXPORT_TOKEN_NAMES).toContain('--bear-title-gap');
  });

  it('derives every heading size from the ratio, with no literal left', () => {
    const html = renderNoteHtml(NOTE, {}, 'en', new Map(), new Map());
    expect(html).not.toMatch(/h1 \{ font-size: 1\.6em/);
    expect(html).toContain(
      'h1 { font-size: calc(var(--bear-heading-ratio) * var(--bear-heading-ratio) * var(--bear-heading-ratio) * 1em); }',
    );
    expect(html).toContain('h3 { font-size: calc(var(--bear-heading-ratio) * 1em); }');
  });

  it('gives the first block the title treatment, keyed off the same gap token', () => {
    const html = renderNoteHtml(NOTE, {}, 'en', new Map(), new Map());
    expect(html).toContain('body > :is(p, h1, h2, h3, h4, h5, h6):first-child');
    expect(html).toContain('calc(var(--bear-title-gap) + var(--bear-para-spacing))');
  });

  // Every token in the list must degrade, or a rename paints nothing.
  it('gives both new tokens a fallback', () => {
    const html = renderNoteHtml(NOTE, {}, 'en', new Map(), new Map());
    expect(html).toContain('--bear-heading-ratio: 1.2');
    expect(html).toContain('--bear-title-gap: 1.75em');
  });
});
```

Match `NOTE` and the `renderNoteHtml` argument list to whatever the surrounding tests in that file already use — read them first rather than assuming this signature.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/export/`
Expected: FAIL on all four.

- [ ] **Step 3: Add the two tokens**

In `EXPORT_TOKEN_NAMES`, after `'--bear-para-indent',`:

```ts
  '--bear-heading-ratio',
  '--bear-title-gap',
```

In `FALLBACKS`, after `'--bear-para-indent': '0em',`:

```ts
  '--bear-heading-ratio': '1.2',
  '--bear-title-gap': '1.75em',
```

- [ ] **Step 4: Derive the heading sizes**

Replace the three literal rules:

```css
    h1 { font-size: 1.6em; }
    h2 { font-size: 1.35em; }
    h3 { font-size: 1.15em; }
```

with:

```css
    h1 { font-size: calc(var(--bear-heading-ratio) * var(--bear-heading-ratio) * var(--bear-heading-ratio) * 1em); }
    h2 { font-size: calc(var(--bear-heading-ratio) * var(--bear-heading-ratio) * 1em); }
    h3 { font-size: calc(var(--bear-heading-ratio) * 1em); }
```

Leave `h4, h5, h6 { font-size: 1em; }` unchanged.

- [ ] **Step 5: Add the title treatment**

Immediately after `body > :first-child { margin-top: 0; }`, add:

```css
    body > :is(p, h1, h2, h3, h4, h5, h6):first-child {
      font-size: calc(var(--bear-heading-ratio) * var(--bear-heading-ratio) * var(--bear-heading-ratio) * 1em);
      color: var(--bear-accent);
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }

    body > :is(p, h1, h2, h3, h4, h5, h6):first-child + * {
      margin-top: calc(var(--bear-title-gap) + var(--bear-para-spacing));
    }
```

**No explanatory comments in this CSS.** Every comment here ships in the eager chunk and in every exported file — sub-project P's first draft cost 960 B, almost entirely comments. The stylesheet already carries one line saying its reasoning lives in `docs/rulings/export.md`; put it there.

Specificity, checked rather than assumed: `body > :is(…):first-child` is (0,1,2) against the heading group's (0,0,1) and `body > * + *`'s (0,0,1), so both title rules win on specificity rather than on source order — the same arrangement `editor.css:218` and `:238` rely on. The export puts nothing before the note's own first block (the title appears only in `<title>`), so `:first-child` selects what the editor's `.ProseMirror > :first-child` selects.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/features/export/
```

Expected: PASS. Read any pre-existing failure carefully — a test asserting the old literal is a test that recorded the divergence, and it should be updated with a comment saying so, not deleted.

- [ ] **Step 7: Look at a real export**

```bash
npm run dev
```

Create a note whose first line is plain text, followed by `# Heading one`, `## Two`, `### Three`. Export it as HTML (⋯ → HTML) and open the file. The first line must be large, accent-coloured and set off by space; h1 must be visibly larger than it was. Then change the font size in the panel and export again — the headings must scale with the body. **A text assertion cannot see any of this**; the same reason `toContain('자산화')` passes on a page of tofu.

- [ ] **Step 8: Add the ruling**

In `docs/rulings/export.md`, record: the export's heading sizes derive from `--bear-heading-ratio` and must never be re-literalised (they were the pre-M9a scale for two milestones and nothing compared them); the title-line treatment mirrors `editor.css:218`/`:238` and its specificity is (0,1,2) deliberately; and the export stylesheet's comment budget — reasoning goes in the ruling, not the CSS.

- [ ] **Step 9: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/export docs/rulings/export.md
git commit -m "fix(q): the export derives its heading scale and gains the title line"
```

---

### Task 8: End-to-end

**Files:**
- Create: `e2e/typography.spec.ts`

**Interfaces:**
- Consumes: the shipped UI.
- Produces: nothing.

**Read first:** `docs/rulings/testing-and-tooling.md`, and `e2e/appearance.spec.ts:1129-1150` — the no-flash test whose observer pattern this copies.

- [ ] **Step 1: Kill any stale preview server**

```bash
lsof -ti:4173 | xargs -r kill -9
```

A preview server left on 4173 is silently reused, and the suite then tests a stale build. This has produced a fault injection that "passed" because the build never re-ran.

- [ ] **Step 2: Write the spec**

Create `e2e/typography.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

async function openPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /typography|타이포그래피/i }).click();
}

const SIZE = /^(Font size|글자 크기)$/;
const WIDTH = /^(Line width|본문 너비)$/;

test('a chosen size applies live and survives a reload', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);

  await page.getByRole('slider', { name: SIZE }).fill('21');

  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bear-font-size').trim(),
      ),
    )
    .toBe('21px');

  await page.getByRole('button', { name: /^(Done|완료)$/ }).click();
  await page.reload();

  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bear-font-size').trim(),
      ),
    )
    .toBe('21px');
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
  await openPanel(page);
  await page.getByRole('slider', { name: SIZE }).fill('21');
  await page.getByRole('button', { name: /^(Done|완료)$/ }).click();

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

test('a corrupt mirror renders the defaults rather than breaking boot', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bear-web:typography', '{oh no'));
  await page.goto('/');

  await expect(page.getByRole('button', { name: /typography|타이포그래피/i })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bear-font-size').trim(),
      ),
    )
    .toBe('16px');
});

test('the chosen typography reaches an exported document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /new note|새 노트/i }).click();
  const editor = page.getByRole('textbox', { name: /note text|노트 내용/i });
  await editor.click();
  await editor.pressSequentially('Exported title line');

  await openPanel(page);
  await page.getByRole('slider', { name: SIZE }).fill('21');
  await page.getByRole('slider', { name: WIDTH }).fill('60');
  await page.getByRole('button', { name: /^(Done|완료)$/ }).click();

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export|내보내기/i }).click(),
    page.getByRole('menuitem', { name: /^HTML$/ }).click(),
  ]).then(([event]) => event);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf8');

  expect(html).toContain('--bear-font-size: 21px');
  expect(html).toContain('--bear-line-width: 60em');
});
```

The export step's selectors are a best guess from `ExportMenu`'s shape — **read `e2e/notes.spec.ts`'s existing export block and copy its actual selectors and download handling** rather than trusting these. If they differ, the ones in the existing spec are right.

- [ ] **Step 3: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/typography.spec.ts
```

Expected: 4 passed. If a test times out waiting for the app, check whether `e2e/notes.spec.ts` also fails — a whole suite timing out identically is the tell for a module-initialisation cycle, not for a bad selector.

- [ ] **Step 4: Injure the no-flash test**

Comment out the typography block in `index.html`'s inline script and re-run **only** the no-flash test:

```bash
npx playwright test e2e/typography.spec.ts -g 'before first paint'
```

Expected: FAIL with `atBody[0]` empty — proving the test discriminates the pre-paint path from a React effect, which is the only thing it is for. Restore and re-run to PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add e2e/typography.spec.ts
git commit -m "test(q): typography persists, applies before first paint, and exports"
```

---

### Task 9: The gate boundary

No new behaviour. This is the one place the full suite runs, and the one place the branch is measured.

**Files:**
- Modify: `CLAUDE.md` (the milestone table, the test counts), `docs/superpowers/NEXT.md` (Q's row), `docs/rulings/design-tokens-and-layout.md` and `docs/rulings/accessibility.md`
- Possibly modify: `scripts/bundleSize.test.ts` (bringing the ceiling DOWN — see Step 4)

- [ ] **Step 1: Check the machine before trusting anything**

```bash
uptime
```

If load is above ~8, wait for it to settle. Several e2e tests fail under load in ways that look exactly like regressions. If load exceeds 20, stop and report.

- [ ] **Step 2: All six gates**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4 && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
```

Expected: all green. Record the unit and e2e counts — they go in `CLAUDE.md`.

- [ ] **Step 3: The seventh gate**

```bash
npm run measure:check
```

Expected: **PASS with no diff.** This is Q's own regression assertion, not a chore: the defaults are today's token values, so no measured surface may move. A diff means the reading preference leaked into the app chrome. If it fails, run `npm run measure` on `main` too before blaming this branch.

- [ ] **Step 4: Measure the closure on both sides, and bring the ceiling down if it is owed**

```bash
npm run build >/dev/null 2>&1
npx vitest run scripts/bundleSize.test.ts
node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
const m=JSON.parse(fs.readFileSync("dist/.vite/manifest.json","utf8"));
const ek=Object.keys(m).find(k=>m[k].isEntry);
const seen=new Set();(function w(k){if(seen.has(k))return;seen.add(k);for(const i of (m[k].imports||[]))w(i);})(ek);
let t=0;for(const k of seen){const b=zlib.gzipSync(fs.readFileSync(path.join("dist",m[k].file))).length;t+=b;console.log(String(b).padStart(8),m[k].file);}
console.log("TOTAL",t,"| cost:",t-347854);
'
```

The raise to 351,000 was granted **on the condition** that the ceiling comes down to the measured figure plus ~3 KB if Q lands under it. So: if the total is at or below ~348,000, set `CEILING_BYTES` to `total + 3000` rounded to the nearest 500, and say so in the docblock with the measured cost. If it is above 348,000, leave 351,000 and record the true cost. Either way the docblock gets the real number — a recorded estimate that was never re-measured is the failure this file has already had twice.

- [ ] **Step 5: Screenshots**

```bash
npm run shots
ls docs/design/shots/*.png | wc -l
```

Expected: **256**. Count the files; do not trust the exit code. The sidebar footer gained a control, so every shot changes — look at three or four across light and dark themes and confirm the new icon sits correctly in the strip and nothing else moved.

- [ ] **Step 6: Run the app once more, by hand**

`npm run dev`. Sign out and in if convenient, open a long note, drag every slider through its full range at a desktop width and at a phone width (devtools, 390px). Confirm: the measure never overflows the pane; the panel is reachable and dismissible by touch; Reset returns everything; a reload holds. Then export the note to PDF and confirm it carries the chosen size.

- [ ] **Step 7: Write the rulings**

- `docs/rulings/design-tokens-and-layout.md` — the five tokens are now user-controlled: they may not be re-hardcoded, a new consumer must read the token rather than a literal, and `DEFAULTS` in `typography.ts` must stay equal to `tokens.css`'s values or `measure:check` becomes meaningless. The bounds are duplicated in `index.html` on purpose and guarded by `sourceLint`.
- `docs/rulings/accessibility.md` — a range's accessible name is its label ALONE, with the value in `aria-valuetext`; the readout is a sibling and `aria-hidden`. Reset is never disabled.

- [ ] **Step 8: Update `CLAUDE.md` and `NEXT.md`**

`CLAUDE.md`: add `| Q typography settings | complete |` to the milestone table and update the test counts to what Step 2 reported. Add nothing else — that file ROUTES, it does not retell. Q's narrative belongs in `NEXT.md`.

`NEXT.md`: move Q to shipped with its spec, plan and ledger paths, and record the four measurements (the 146 B, the +322 B lazy result, the arbitrary chunk names, the stale export heading scale). Confirm the `themes-*` correction from Task 1 is still in place and that no "obvious candidate" sentence survives anywhere.

- [ ] **Step 9: Commit**

```bash
npm run format
git add -A
git commit -m "docs(q): record the typography settings sub-project"
```

- [ ] **Step 10: Report, do not merge**

Report to the controller: the six gates' results, the `measure:check` result, the both-sides byte figures and whether the ceiling moved down, the screenshot count, and anything found by hand that no gate saw. **The controller merges this branch.** Do not merge to `main` yourself.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the ceiling raise and the `themes-*` correction → Task 1; the model, guard, bounds and mirror → Task 2; the hook, its `useTheme` shape and the healing repair → Task 3; the pre-paint script and its guard → Task 4; the panel, the control shape, the debounce, the accessibility rules and the i18n → Task 5; the trigger and its mounting → Task 6; both export divergences → Task 7; the three e2e assertions the spec names → Task 8; `measure:check`-must-pass-unchanged, both-sides bytes, shots, the rulings and the docs → Task 9. The spec's "out of scope" list adds no tasks by design.

**Type consistency.** `Typography`'s five field names (`fontSize`, `lineHeight`, `lineWidth`, `paraSpacing`, `paraIndent`) are identical in `BOUNDS`, `DEFAULTS`, `typographyProperties`, `snapField`, `ROWS`, the i18n keys, the pre-paint script's three lookup tables and every test. `applyTypography(value, root?)` is called with one argument everywhere except `typography.test.ts`. `onCommit` is the panel's prop name and `set` is the hook's method; Task 6 wires `onCommit={set}`, which is the only place the two meet.

**Known soft spots, flagged rather than hidden.** Task 7's test file name and `renderNoteHtml` argument list, and Task 8's export-menu selectors, are written from the shape of the code rather than from the test files themselves; both steps say to read the existing tests and prefer what is there. Task 5's `accent-accent` utility has its own verification step because Tailwind v4 fails silently. Task 5 Step 1 verifies the lucide glyph exists before anything imports it, because a plan's icon names have been wrong here before.
