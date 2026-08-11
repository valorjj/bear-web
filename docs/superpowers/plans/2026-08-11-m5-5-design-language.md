# M5.5 Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `tokens.css` from a seven-colour palette into a design system — real typefaces, role colours, a UI type scale, radii, elevation and motion — rebuild `src/ui/` against it, restyle every surface, and make three currently-unenforced rules fail when violated.

**Architecture:** All visual decisions live in `src/styles/tokens.css` as `--bear-*` custom properties, exposed to Tailwind v4 through `@theme inline` in `src/styles/index.css`. Components reference Tailwind utilities that resolve to those properties and never contain a colour, size, or duration literal. Source-scanning tests live in `scripts/` — outside `src/`, because `tsconfig.app.json` deliberately excludes Node types.

**Tech Stack:** Tailwind CSS v4 (`@theme inline`), `pretendard` 1.3.9 (variable dynamic subset), `@fontsource-variable/jetbrains-mono` 5.3.0, Vitest, React Testing Library.

## Global Constraints

These apply to **every** task. They are the project's standing rules; violating one is a task failure even if its own tests pass.

- **All six gates must pass before any commit:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and (at task end where UI changed) `npm run test:e2e`.
- **`npm run lint` has a baseline of 5 warnings.** Do not introduce a sixth. Do not "fix" the existing five in this milestone.
- **Check exit codes, not pass counts.** An editor test can print all-green and still exit 1 on an uncaught error.
- **Every colour comes from a CSS custom property.** A literal hex, `rgb()`, or `hsl()` anywhere under `src/` except `src/styles/tokens.css` is a defect. Task 2 makes this a failing test.
- **`src/ui/` must import nothing** from `src/app/`, `src/data/`, `src/features/`, or `src/i18n/`. Every user-facing string arrives as a prop, already translated by the caller.
- **No user-facing string is hardcoded in a component.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is `Record<TranslationKey, string>`, so a missing Korean translation is a compile error. **Never weaken that annotation** — add the translation.
- **The three-block theme structure in `tokens.css` is load-bearing and must not be simplified.** Bare `:root` is light; `:root[data-theme='dark']` is dark; `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }` repeats dark. M8's theme picker drives that `:not()` seam. Every new themed token must appear in all three blocks.
- **`erasableSyntaxOnly`** forbids `enum`, parameter properties, and namespaces. **`verbatimModuleSyntax`** requires `import type` / `export type`.
- **No `eslint.config.js`.** The project uses oxlint. There is no import sorting; order imports by hand to match surrounding files.
- **Behaviour does not change in this milestone.** No component's props contract, event handling, or accessibility semantics change except where a task says so explicitly. This is a visual refactor.
- **When an existing test breaks because it asserts a Tailwind class name, the test is the defect.** Rewrite it to assert role, accessible name, or `aria-current`. Do not preserve a class-name assertion by keeping a class you would otherwise change.

### Locked token values

Copy these verbatim. They are referenced by several tasks.

| Token               | Paper (light)            | Ink (dark)                |
| ------------------- | ------------------------ | ------------------------- |
| `--bear-bg`         | `#ffffff`                | `#1a1a19`                 |
| `--bear-surface`    | `#faf9f8`                | `#201f1e`                 |
| `--bear-sidebar`    | `#f1efec`                | `#262523`                 |
| `--bear-text`       | `#1c1b19`                | `#ebe9e5`                 |
| `--bear-muted`      | `#6b6862`                | `#a09c94`                 |
| `--bear-faint`      | `#9c988f`                | `#746f68`                 |
| `--bear-border`     | `#e5e2dd`                | `#35332f`                 |
| `--bear-accent`     | `#cf3b2c`                | `#ff6f5e`                 |
| `--bear-danger`     | `#cf3b2c`                | `#ff6f5e`                 |
| `--bear-focus`      | `#cf3b2c`                | `#ff6f5e`                 |
| `--bear-hover`      | `rgb(28 27 25 / 0.05)`   | `rgb(255 255 255 / 0.06)` |
| `--bear-selected`   | `rgb(207 59 44 / 0.11)`  | `rgb(255 111 94 / 0.18)`  |
| `--bear-shadow`     | `rgb(28 27 25 / 0.14)`   | `rgb(0 0 0 / 0.5)`        |

### Setup, before Task 1

```bash
git checkout -b m5.5-design-language
```

All tasks commit to this branch. It merges to `main` locally at the end.

---

### Task 1: Load the typefaces, and pin their real family names

**Files:**

- Modify: `package.json` (dependencies)
- Modify: `src/styles/index.css:1-2` (font imports)
- Modify: `src/styles/tokens.css:10-11` (`--bear-font-sans`, `--bear-font-mono`)
- Create: `scripts/fonts.test.ts`
- Create: `docs/design/FONT-LICENSES.md`

**Interfaces:**

- Consumes: nothing.
- Produces: `--bear-font-sans` resolving to a family the app actually ships. No exported symbols.

**Background — this task fixes two defects, not one.**

`tokens.css` has declared `--bear-font-sans: 'Pretendard', system-ui, sans-serif` since M2. There is no `@font-face`, no `<link>` in `index.html`, and no font package in `package.json`. Every build since M0 has silently fallen back to `system-ui`.

**The second defect is subtler and would survive a naive fix.** The npm packages register their families as **`'Pretendard Variable'`** and **`'JetBrains Mono Variable'`** — not `'Pretendard'` and not `'JetBrains Mono'`. Adding the import while leaving the token strings alone leaves the app on `system-ui` with a green build and 92 downloaded font files that nothing references. The test below is written to catch exactly that, which is why it compares the token's family name against the family names the package's own CSS declares, rather than merely checking that an import exists.

**Why the variable dynamic subset.** `pretendard` ships several distributions. `dist/web/static/pretendard-dynamic-subset.css` is 828 `.woff` files (nine weights × 92 ranges). `dist/web/variable/pretendardvariable-dynamic-subset.css` is 92 `.woff2` files totalling 3.0 MB, one variable font spanning `font-weight: 45 920`. Use the variable one. Ranges are split by `unicode-range`, so an English-only session fetches roughly one 36 KB subset and a Korean note fetches only the Hangul ranges it uses. The 3.0 MB is deploy size, not download size.

**Self-hosted, not a CDN.** The app is a static Pages deploy whose privacy story is that nothing leaves the browser. A font CDN is an outbound third-party request on every load.

- [ ] **Step 1: Install the packages**

```bash
npm install pretendard@1.3.9 @fontsource-variable/jetbrains-mono@5.3.0
```

- [ ] **Step 2: Write the failing test**

Create `scripts/fonts.test.ts`.

This file lives in `scripts/`, not `src/`, on purpose. `tsconfig.app.json` sets `"types": ["vite/client", "vitest/globals"]` with no `node`, so a `node:fs` import under `src/` must fail typecheck — that is a deliberate boundary recorded in `CLAUDE.md`. `tsconfig.node.json` already lists `"scripts"` in its `include`, so a new file here is typechecked under the Node project with no config change.

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/** Every `font-family: '...'` declared by a stylesheet's @font-face rules. */
function declaredFamilies(cssPath: string): Set<string> {
  const css = readFileSync(cssPath, 'utf8');
  const families = new Set<string>();
  for (const match of css.matchAll(/font-family:\s*'([^']+)'/g)) {
    families.add(match[1]!);
  }
  return families;
}

/** The first quoted family in a `--bear-font-*` declaration. */
function tokenFamily(token: string): string {
  const css = readFileSync('src/styles/tokens.css', 'utf8');
  const declaration = new RegExp(`${token}:\\s*([^;]+);`).exec(css);
  expect(declaration, `${token} is not declared in tokens.css`).not.toBeNull();

  const quoted = /'([^']+)'/.exec(declaration![1]!);
  expect(quoted, `${token} names no quoted family: ${declaration![1]}`).not.toBeNull();
  return quoted![1]!;
}

describe('typefaces', () => {
  const indexCss = readFileSync('src/styles/index.css', 'utf8');

  const SANS_CSS = require.resolve(
    'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css',
  );
  const MONO_CSS = require.resolve('@fontsource-variable/jetbrains-mono/index.css');

  it('imports both font stylesheets from index.css', () => {
    expect(indexCss).toContain('pretendardvariable-dynamic-subset.css');
    expect(indexCss).toContain('@fontsource-variable/jetbrains-mono');
  });

  // This is the assertion whose absence let the defect live since M2. It is not
  // enough that the package is installed and imported: the family named by the
  // token must be a family the package actually registers. The packages ship
  // 'Pretendard Variable' and 'JetBrains Mono Variable', NOT 'Pretendard' and
  // 'JetBrains Mono' — a token naming the latter silently falls back to
  // system-ui with everything else green.
  it('names a sans family the shipped stylesheet actually declares', () => {
    expect(declaredFamilies(SANS_CSS)).toContain(tokenFamily('--bear-font-sans'));
  });

  it('names a mono family the shipped stylesheet actually declares', () => {
    expect(declaredFamilies(MONO_CSS)).toContain(tokenFamily('--bear-font-mono'));
  });

  it('keeps a fallback stack after the webfont', () => {
    // A webfont that fails to load must not leave text in the browser default.
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    expect(/--bear-font-sans:[^;]*sans-serif/.test(css)).toBe(true);
    expect(/--bear-font-mono:[^;]*monospace/.test(css)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reasons**

```bash
npx vitest run scripts/fonts.test.ts
```

Expected: the import test fails (`index.css` imports neither package) and both family tests fail (the tokens say `'Pretendard'` / `'JetBrains Mono'`; the packages declare `'Pretendard Variable'` / `'JetBrains Mono Variable'`). The fallback test passes already.

Read the family-mismatch failure message and confirm it names the two different strings. If it does not, the test is not pinning what this task exists to pin.

- [ ] **Step 4: Import the stylesheets**

In `src/styles/index.css`, add both imports **above** the existing `@import 'tailwindcss';`. CSS `@import` rules must precede other rules, and Tailwind's own import brings rules with it.

```css
@import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
@import '@fontsource-variable/jetbrains-mono/index.css';
@import 'tailwindcss';
@import './tokens.css';
```

- [ ] **Step 5: Correct the family names in `tokens.css`**

```css
  --bear-font-sans: 'Pretendard Variable', system-ui, sans-serif;
  --bear-font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
npx vitest run scripts/fonts.test.ts
```

Expected: 4 passed.

- [ ] **Step 7: Falsify the test**

This step is mandatory. A test that cannot fail is worse than no test, and this project has shipped five of them.

1. Change `--bear-font-sans` back to `'Pretendard'`. Re-run. The sans family test **must** redden. Restore it.
2. Remove the `pretendard` `@import` line. Re-run. The import test **must** redden. Restore it.

If either stays green, the test is wrong — fix the test, not the code.

- [ ] **Step 8: Record the licences**

Both fonts are SIL Open Font License 1.1. The repository is public, so attribution belongs in the tree rather than only in `node_modules`.

Create `docs/design/FONT-LICENSES.md`:

```markdown
# Bundled typefaces

Both are redistributed under the SIL Open Font License 1.1, which permits
bundling and web embedding with attribution and requires that the fonts not be
sold on their own.

## Pretendard

Copyright (c) 2021 Kil Hyung-jin, with Reserved Font Name Pretendard.
https://github.com/orioncactus/pretendard

Shipped as the variable dynamic subset: one variable font spanning
`font-weight: 45 920`, split into 92 `unicode-range` slices so a page fetches
only the ranges it renders.

## JetBrains Mono

Copyright (c) 2020 The JetBrains Mono Project Authors.
https://github.com/JetBrains/JetBrainsMono

Shipped via `@fontsource-variable/jetbrains-mono`.

Full licence text for both: `node_modules/pretendard/LICENSE` and
`node_modules/@fontsource-variable/jetbrains-mono/LICENSE`.
```

- [ ] **Step 9: Verify the build actually emits the fonts**

```bash
npm run build
ls dist/assets | grep -c -i 'woff2'
```

Expected: a non-zero count. If it is zero, Vite did not follow the `@import` and the fonts will 404 in production — the exact failure this task exists to prevent. Investigate before continuing.

- [ ] **Step 10: Run all six gates**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/styles/ scripts/fonts.test.ts docs/design/FONT-LICENSES.md
git commit -m "fix(design): actually load the typefaces tokens.css has always named

The packages register 'Pretendard Variable' and 'JetBrains Mono
Variable'; the tokens named 'Pretendard' and 'JetBrains Mono', so even
importing them would have left the app on system-ui."
```

---

### Task 2: Make two stated-but-unenforced rules into failing tests

**Files:**

- Create: `scripts/sourceLint.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing importable. A guard.

**Background — this task closes two rules the project states and nothing checks.**

`CLAUDE.md` has said since M2 that "Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect." Nothing has ever checked.

`CLAUDE.md` also states the architecture boundaries — `src/ui/` must import nothing from `src/app/`, `src/data/`, or `src/i18n/`; `src/lib/` must import nothing from `src/app/`, `src/data/`, `src/features/` or `src/i18n/`; `src/data/` must not import from `src/features/`. **These are enforced by nothing either.** `src/ui/ui.test.tsx:10` carries a *comment* reading "`src/ui` must not import from `src/app`" — a comment is not a test. oxlint has no import-restriction rule configured, and `CLAUDE.md` already admits the parallel case for `markdown.ts`: "This is convention enforced by nothing."

The precedent for why both matter is the underline mark: the parent spec, `CLAUDE.md`, and a passing test all asserted a rule while the app shipped violating it for an entire milestone, because the test asserted the UI instead of the thing that decided the behaviour.

**The codebase is currently clean on both counts**, so every assertion here passes the moment it is written. That makes Step 3's falsification the only real verification in this task — do not skip it.

**On the heuristic.** A naive `#[0-9a-f]{3,6}` scan produces false positives: `#face`, `#dad` and `#beef` are valid hex *and* valid tags, and this codebase is full of tag fixtures. The scan therefore excludes test files and requires the match to sit inside a `className`, a `style` value, or a `.css` file. This catches the realistic mistake — someone typing a colour into a component — and is documented as not being a proof.

- [ ] **Step 1: Write the test**

Create `scripts/sourceLint.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TOKENS = 'src/styles/tokens.css';

/** Every file under `dir` with one of `extensions`, recursively. */
function walk(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

/**
 * Lines that could carry a colour into the rendered page. Restricted to CSS
 * files and to `className` / `style` regions of components, because a raw hex
 * scan over TSX matches tag fixtures: `#face` and `#dad` are valid hex and
 * valid tags. A heuristic, not a proof — it catches someone typing a colour
 * into a component, which is the mistake that actually happens.
 */
function suspectLines(path: string): string[] {
  const source = readFileSync(path, 'utf8');

  return source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      if (!COLOUR.test(line)) return false;
      if (path.endsWith('.css')) return true;
      return /className|style=|style:/.test(line);
    })
    .map(({ line, number }) => `${path}:${number}  ${line.trim()}`);
}

describe('design lint', () => {
  const files = [
    ...walk('src', ['.css']),
    ...walk('src', ['.tsx', '.ts']).filter((path) => !/\.test\.tsx?$/.test(path)),
  ].filter((path) => path !== TOKENS);

  it('scans a non-trivial number of files', () => {
    // Guards the guard: a walk() that silently returns [] would make every
    // assertion below vacuously true.
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no colour literal outside tokens.css', () => {
    const offenders = files.flatMap(suspectLines);
    expect(offenders, `colour literals must live in ${TOKENS}`).toEqual([]);
  });
});

/**
 * The import boundaries CLAUDE.md states and nothing has ever checked. Before
 * M5.5 the only trace of the `src/ui` rule was a COMMENT in `ui.test.tsx`;
 * oxlint has no import-restriction rule configured, so a violating import
 * would simply have worked.
 */
describe('architecture boundaries', () => {
  const BOUNDARIES: ReadonlyArray<{ dir: string; forbidden: readonly string[]; why: string }> = [
    {
      dir: 'src/ui',
      forbidden: ['@/app', '@/data', '@/features', '@/i18n'],
      why: 'presentation primitives take strings and numbers as props',
    },
    {
      dir: 'src/lib',
      forbidden: ['@/app', '@/data', '@/features', '@/i18n'],
      why: 'framework-level hooks carry no product knowledge',
    },
    {
      dir: 'src/data',
      forbidden: ['@/features'],
      why: 'the data layer is the dependency, never the dependent',
    },
  ];

  for (const { dir, forbidden, why } of BOUNDARIES) {
    it(`${dir} imports none of ${forbidden.join(', ')} — ${why}`, () => {
      const offenders = walk(dir, ['.ts', '.tsx'])
        .filter((path) => !/\.test\.tsx?$/.test(path))
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8');
          return [...source.matchAll(/from\s+'([^']+)'/g)]
            .map((match) => match[1]!)
            .filter((specifier) =>
              forbidden.some((root) => specifier === root || specifier.startsWith(`${root}/`)),
            )
            .map((specifier) => `${path} imports ${specifier}`);
        });

      expect(offenders).toEqual([]);
    });
  }

  it('scans a non-trivial number of files in each guarded directory', () => {
    // Guards the guard, again: a typo'd directory name would make every
    // boundary above vacuously true.
    for (const { dir } of BOUNDARIES) {
      expect(walk(dir, ['.ts', '.tsx']).length, `${dir} looks empty`).toBeGreaterThan(2);
    }
  });
});
```

Relative imports (`./scope`, `../db`) cannot cross these boundaries — they would have to climb out of the directory — so matching only the `@/` alias is sufficient and avoids resolving paths.

- [ ] **Step 2: Run it and confirm it passes**

```bash
npx vitest run scripts/sourceLint.test.ts
```

Expected: 6 passed. The codebase is clean today on both counts.

- [ ] **Step 3: Falsify it — this is the whole task**

1. Add `className="bg-[#ff0000]"` to any element in `src/ui/EmptyState.tsx`. Re-run. The colour test **must** redden and its message must name that file and line. Revert.
2. In `src/features/notes/NoteListItem.tsx`, add a line `const shade = 'rgb(1 2 3)';` **without** `className` or `style` on it. Re-run. It **must stay green** — this confirms the scan is scoped as designed rather than matching everything. Revert.
3. Change `walk('src', ['.css'])` to `walk('src', ['.nonexistent'])`. Re-run. The file-count test **must** redden. Revert.
4. Add `import { useT } from '@/i18n';` to `src/ui/EmptyState.tsx`. Re-run. The `src/ui` boundary test **must** redden and name the file. Revert.
5. Add `import { notes } from '@/data';` to `src/lib/useFlushTriggers.ts`. Re-run. The `src/lib` boundary test **must** redden. Revert.

- [ ] **Step 4: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add scripts/sourceLint.test.ts
git commit -m "test: enforce the colour-literal and import-boundary rules

CLAUDE.md has stated both since M2. The only trace of the src/ui
boundary was a comment in ui.test.tsx; oxlint has no import-restriction
rule, so a violating import would simply have worked."
```

---

### Task 3: Grow `tokens.css` into a system

**Files:**

- Modify: `src/styles/tokens.css` (whole file)
- Modify: `scripts/sourceLint.test.ts` (add the theme-token describe)

**Interfaces:**

- Consumes: nothing.
- Produces: the `--bear-*` custom properties every later task references. Exact names are in the tables below; later tasks depend on these spellings.

**Background.** The theme structure must stay three blocks (see Global Constraints). The failure mode this task's parity test closes: adding a token to `:root` and to `:root[data-theme='dark']` but forgetting the `prefers-color-scheme` block, so the token is correct for someone who picked dark explicitly and wrong for someone on system dark. That is invisible in every test the project has.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/sourceLint.test.ts`:

```ts
/** `--name: value` pairs inside the first `{ … }` following `selector`. */
function blockTokens(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0);

  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);

  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

describe('theme tokens', () => {
  const css = readFileSync(TOKENS, 'utf8');

  const light = blockTokens(css, ':root {');
  const darkExplicit = blockTokens(css, ":root[data-theme='dark']");
  const darkSystem = blockTokens(css, ":root:not([data-theme='light'])");

  it('defines a non-trivial number of tokens in each theme block', () => {
    expect(light.size).toBeGreaterThan(20);
    expect(darkExplicit.size).toBeGreaterThan(10);
  });

  // The defect this closes: a token added to :root and to the explicit dark
  // block but forgotten in the media block is correct for a user who picked
  // dark and wrong for a user whose OS is dark. Nothing else in the suite
  // can see that.
  it('keeps both dark blocks token-for-token identical', () => {
    expect([...darkSystem.keys()].sort()).toEqual([...darkExplicit.keys()].sort());
    for (const [token, value] of darkExplicit) {
      expect(darkSystem.get(token), `${token} differs between the dark blocks`).toBe(value);
    }
  });

  it('overrides only tokens the light theme already defines', () => {
    for (const token of darkExplicit.keys()) {
      expect(light.has(token), `${token} is dark-only; add it to :root`).toBe(true);
    }
  });

  it('themes every colour role', () => {
    const ROLES = [
      'bg',
      'surface',
      'sidebar',
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
    ];
    for (const role of ROLES) {
      expect(light.has(`--bear-${role}`), `--bear-${role} missing from :root`).toBe(true);
      expect(darkExplicit.has(`--bear-${role}`), `--bear-${role} missing from Ink`).toBe(true);
    }
  });

  it('zeroes both duration tokens under prefers-reduced-motion', () => {
    // Motion is tokenized rather than written per-component precisely so that
    // one media block disables every animation in the app, including ones
    // added after this test was written.
    const reduced = blockTokens(css, '@media (prefers-reduced-motion: reduce)');
    expect(reduced.get('--bear-duration-fast')).toBe('0ms');
    expect(reduced.get('--bear-duration')).toBe('0ms');
  });
});
```

Note: `blockTokens` finds the first `{` after the selector. For the reduced-motion block, write the CSS so `:root {` is on the line immediately after the `@media` line — the first `{` after `@media (prefers-reduced-motion: reduce)` is the media block's own brace, and the first `}` closes the inner `:root`. Step 2 below confirms the parser handles the file you actually wrote; if it does not, adjust the CSS layout rather than loosening the test.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run scripts/sourceLint.test.ts
```

Expected: the role test fails (no `--bear-faint`, `--bear-danger`, `--bear-focus`, `--bear-hover`, `--bear-selected`, `--bear-shadow`) and the reduced-motion test fails (no such block).

- [ ] **Step 3: Rewrite `src/styles/tokens.css`**

```css
:root {
  /* Paper — the light theme. Warm neutrals, one red. */
  --bear-bg: #ffffff;
  --bear-surface: #faf9f8;
  --bear-sidebar: #f1efec;
  --bear-text: #1c1b19;
  --bear-muted: #6b6862;
  --bear-faint: #9c988f;
  --bear-border: #e5e2dd;
  --bear-accent: #cf3b2c;

  /*
   * `danger` and `focus` resolve to the accent in both shipped themes, and are
   * still separate tokens: an M8 theme with a green accent must not render its
   * Delete Forever button green. Call sites express intent, not colour.
   */
  --bear-danger: #cf3b2c;
  --bear-focus: #cf3b2c;

  /*
   * Translucent, deliberately. These sit over three different backgrounds —
   * sidebar, note list, and editor canvas — so no solid fill could be one
   * token. `selected` is accent-tinted rather than neutral, which is what
   * makes a selected row read as MORE present than its surroundings. Before
   * M5.5 selection was `bg-bg`, i.e. less contrast than unselected: a hole
   * rather than a highlight.
   */
  --bear-hover: rgb(28 27 25 / 0.05);
  --bear-selected: rgb(207 59 44 / 0.11);
  --bear-shadow: rgb(28 27 25 / 0.14);

  --bear-font-sans: 'Pretendard Variable', system-ui, sans-serif;
  --bear-font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;

  /*
   * UI type, separate from editor type below. 13px is the workhorse: a
   * macOS-idiom application sets its chrome one notch smaller than the web
   * default, and before M5.5 this app used 14px throughout.
   */
  --bear-text-ui-xs: 0.6875rem; /* 11px — counts, badges */
  --bear-text-ui-sm: 0.75rem; /* 12px — timestamps, snippets */
  --bear-text-ui: 0.8125rem; /* 13px — rows, buttons */
  --bear-text-ui-md: 0.875rem; /* 14px — note titles */
  --bear-text-ui-lg: 1rem; /* 16px — pane headers, empty states */
  --bear-leading-ui: 1.45;

  --bear-radius-sm: 4px;
  --bear-radius-md: 6px;
  --bear-radius-lg: 10px;

  /* Two, because the app has exactly two floating surfaces. */
  --bear-shadow-popover: 0 4px 12px var(--bear-shadow);
  --bear-shadow-dialog: 0 12px 32px var(--bear-shadow);

  --bear-duration-fast: 100ms;
  --bear-duration: 160ms;
  --bear-ease: cubic-bezier(0.2, 0, 0.2, 1);

  /* Editor typography, bound to the M8 preference sliders. */
  --bear-font-size: 16px;
  --bear-line-height: 1.6;
  --bear-line-width: 56em;
  --bear-para-spacing: 0em;
  --bear-para-indent: 0em;
}

/* Ink — the dark theme, chosen explicitly. */
:root[data-theme='dark'] {
  --bear-bg: #1a1a19;
  --bear-surface: #201f1e;
  --bear-sidebar: #262523;
  --bear-text: #ebe9e5;
  --bear-muted: #a09c94;
  --bear-faint: #746f68;
  --bear-border: #35332f;
  --bear-accent: #ff6f5e;
  --bear-danger: #ff6f5e;
  --bear-focus: #ff6f5e;
  --bear-hover: rgb(255 255 255 / 0.06);
  --bear-selected: rgb(255 111 94 / 0.18);
  --bear-shadow: rgb(0 0 0 / 0.5);
}

/*
 * The system preference is the default, applied with no JavaScript so there is
 * no flash of the wrong theme on first paint. An explicit `data-theme` on the
 * root overrides it — that is the seam the M8 theme picker will drive, and the
 * `:not([data-theme='light'])` must not be simplified away.
 *
 * This block must stay token-for-token identical to the one above;
 * `scripts/sourceLint.test.ts` asserts it.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bear-bg: #1a1a19;
    --bear-surface: #201f1e;
    --bear-sidebar: #262523;
    --bear-text: #ebe9e5;
    --bear-muted: #a09c94;
    --bear-faint: #746f68;
    --bear-border: #35332f;
    --bear-accent: #ff6f5e;
    --bear-danger: #ff6f5e;
    --bear-focus: #ff6f5e;
    --bear-hover: rgb(255 255 255 / 0.06);
    --bear-selected: rgb(255 111 94 / 0.18);
    --bear-shadow: rgb(0 0 0 / 0.5);
  }
}

/*
 * Motion is expressed as two duration tokens rather than per-component
 * durations for exactly this: one block disables every animation in the app,
 * including animations added long after it was written.
 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --bear-duration-fast: 0ms;
    --bear-duration: 0ms;
  }
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run scripts/sourceLint.test.ts
```

Expected: all green, including the colour-literal test — the new `rgb()` values are in `tokens.css`, which the scan excludes.

- [ ] **Step 5: Falsify**

1. Delete `--bear-focus` from the `prefers-color-scheme` block only. Re-run. The dark-parity test **must** redden naming `--bear-focus`. Restore.
2. Change `--bear-duration: 0ms` in the reduced-motion block to `10ms`. Re-run. That test **must** redden. Restore.
3. Add `--bear-invented: #000000` to the explicit dark block only. Re-run. **Two** tests must redden — parity and light-defines-it. Restore.

- [ ] **Step 6: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/styles/tokens.css scripts/sourceLint.test.ts
git commit -m "feat(design): grow tokens.css from a palette into a system

Adds faint/danger/focus/hover/selected/shadow roles, a UI type scale,
radii, elevation and motion, plus tests pinning dark-block parity and
the reduced-motion override."
```

---

### Task 4: Expose the tokens to Tailwind, and make focus visible everywhere

**Files:**

- Modify: `src/styles/index.css`

**Interfaces:**

- Consumes: every `--bear-*` from Task 3.
- Produces: the Tailwind utilities later tasks use — `bg-hover`, `bg-selected`, `text-faint`, `bg-danger`, `text-ui`, `text-ui-sm`, `text-ui-md`, `text-ui-lg`, `text-ui-xs`, `rounded-sm|md|lg`, `shadow-popover`, `shadow-dialog`, `ease-bear`.

**Background — a third invisible defect.** `TopControls` and `BottomToolbar` already write `hover:bg-hover`. `--color-hover` does not exist in the `@theme` block, so Tailwind never generates that class and **those toolbar buttons have no hover state at all today**. This task makes existing markup start working; that is expected, not a regression.

**On durations.** Tailwind v4 has `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*` and `--ease-*` theme namespaces, but **no `--duration-*` namespace.** Durations are therefore written at call sites as `duration-[var(--bear-duration-fast)]`. Do not invent a `--duration-fast` theme key expecting `duration-fast` to work.

- [ ] **Step 1: Rewrite the `@theme inline` block and add the global rules**

Replace the contents of `src/styles/index.css` below the imports:

```css
@import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
@import '@fontsource-variable/jetbrains-mono/index.css';
@import 'tailwindcss';
@import './tokens.css';

@theme inline {
  --color-bg: var(--bear-bg);
  --color-surface: var(--bear-surface);
  --color-sidebar: var(--bear-sidebar);
  --color-text: var(--bear-text);
  --color-muted: var(--bear-muted);
  --color-faint: var(--bear-faint);
  --color-accent: var(--bear-accent);
  --color-danger: var(--bear-danger);
  --color-focus: var(--bear-focus);
  --color-border: var(--bear-border);
  --color-hover: var(--bear-hover);
  --color-selected: var(--bear-selected);

  --font-sans: var(--bear-font-sans);
  --font-mono: var(--bear-font-mono);

  --text-ui-xs: var(--bear-text-ui-xs);
  --text-ui-xs--line-height: 1.4;
  --text-ui-sm: var(--bear-text-ui-sm);
  --text-ui-sm--line-height: var(--bear-leading-ui);
  --text-ui: var(--bear-text-ui);
  --text-ui--line-height: var(--bear-leading-ui);
  --text-ui-md: var(--bear-text-ui-md);
  --text-ui-md--line-height: 1.4;
  --text-ui-lg: var(--bear-text-ui-lg);
  --text-ui-lg--line-height: 1.35;

  --radius-sm: var(--bear-radius-sm);
  --radius-md: var(--bear-radius-md);
  --radius-lg: var(--bear-radius-lg);

  --shadow-popover: var(--bear-shadow-popover);
  --shadow-dialog: var(--bear-shadow-dialog);

  --ease-bear: var(--bear-ease);
}

html,
body,
#root {
  height: 100%;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/*
 * One global focus ring, replacing the per-component focus-visible utilities
 * that existed on `Button` and nowhere else. No component may set
 * `outline-none` without supplying a visible replacement — `Resizer` is the
 * one exception, and it draws its own accent hairline on
 * `group-focus-visible`.
 */
:focus-visible {
  outline: 2px solid var(--bear-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Add the focus test**

Append to `scripts/sourceLint.test.ts`:

```ts
describe('focus', () => {
  it('defines one global focus-visible ring driven by the focus token', () => {
    const css = readFileSync('src/styles/index.css', 'utf8');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--bear-focus\)/);
  });

  // `Resizer` is the one legitimate exception: it suppresses the default ring
  // because its own accent hairline IS its focus indicator, drawn on
  // `group-focus-visible`. Any OTHER component reaching for `outline-none` has
  // removed a focus ring and supplied nothing.
  it('lets only Resizer suppress the outline, and only with a replacement', () => {
    const suppressors = walk('src', ['.tsx'])
      .filter((path) => !/\.test\.tsx$/.test(path))
      .filter((path) => /outline-none/.test(readFileSync(path, 'utf8')));

    expect(suppressors).toEqual(['src/ui/Resizer.tsx']);
    expect(readFileSync('src/ui/Resizer.tsx', 'utf8')).toContain('group-focus-visible:');
  });
});
```

Run it: `npx vitest run scripts/sourceLint.test.ts`. The first test fails until Step 1's CSS is in place; the second passes already (`Resizer` is the only current suppressor). If the second test fails naming another file, that file has been silently unfocusable — fix it before continuing rather than widening the expectation.

Falsify: delete the `:focus-visible` block from `index.css` — the first test must redden. Add `focus-visible:outline-none` to `src/ui/Button.tsx` — the second must redden. Restore both.

- [ ] **Step 3: Verify the utilities actually generate**

Tailwind v4 only emits utilities it sees used. Confirm the theme keys are registered by building and grepping the output CSS for the custom properties:

```bash
npm run build
grep -c -- '--color-hover' dist/assets/*.css
```

Expected: at least 1. A zero means the `@theme inline` key was rejected — check the spelling before continuing.

- [ ] **Step 4: Confirm the toolbar hover now resolves**

```bash
npm run dev
```

Open the app, create a note, and hover a Bold/Italic button in either toolbar. A faint fill must appear. Before this task there was none. Stop the dev server.

- [ ] **Step 5: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/styles/index.css scripts/sourceLint.test.ts
git commit -m "feat(design): map the token system onto Tailwind, and focus rings

Adds the missing --color-hover that TopControls and BottomToolbar have
referenced since M4, so their hover states start working."
```

---

### Task 5: `Button` variants, sizes, and a disabled state

**Files:**

- Modify: `src/ui/Button.tsx`
- Modify: `src/ui/ui.test.tsx` (add a `Button` describe)

**Interfaces:**

- Consumes: `bg-hover`, `bg-accent`, `bg-danger`, `text-ui`, `text-ui-sm`, `rounded-sm`, `ease-bear` from Task 4.
- Produces:

```ts
export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  onClick: () => void;
  children: ReactNode;
  label?: string;
  variant?: ButtonVariant; // default: 'default'
  size?: ButtonSize; // default: 'md'
  disabled?: boolean; // default: false
  className?: string;
}
```

M6 consumes `variant="danger"` for Delete Forever and `disabled` for Empty Trash on an empty bin. Both new props default to today's appearance, so no existing call site changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/ui.test.tsx`:

```tsx
describe('Button', () => {
  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses `label` as the accessible name when the child is a glyph', () => {
    render(
      <Button onClick={vi.fn()} label="Delete forever">
        ✕
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Empty trash
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Empty trash' });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  // Pins that `danger` resolves to the danger token and NOT to the accent
  // token. They are the same colour in both shipped themes, so nothing else
  // would notice a call site reaching for `accent` — until an M8 theme with a
  // green accent renders a green delete button.
  it('renders the danger variant from the danger token', () => {
    render(
      <Button onClick={vi.fn()} variant="danger">
        Delete forever
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Delete forever' }).className).toContain('bg-danger');
  });

  it('gives every variant a distinct appearance', () => {
    const variants = ['default', 'primary', 'danger', 'ghost'] as const;
    const classNames = variants.map((variant) => {
      const { unmount } = render(
        <Button onClick={vi.fn()} variant={variant}>
          {variant}
        </Button>,
      );
      const className = screen.getByRole('button', { name: variant }).className;
      unmount();
      return className;
    });

    expect(new Set(classNames).size).toBe(variants.length);
  });

  it('defaults to the default variant at md size', () => {
    const { unmount } = render(<Button onClick={vi.fn()}>Bare</Button>);
    const bare = screen.getByRole('button', { name: 'Bare' }).className;
    unmount();

    render(
      <Button onClick={vi.fn()} variant="default" size="md">
        Explicit
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Explicit' }).className).toBe(bare);
  });
});
```

These assert class names, which the Global Constraints call a defect in behavioural tests. They are legitimate here for one reason: this component's *product* is its class names. There is no other observable difference between a danger button and a ghost one in jsdom, which renders no CSS.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/ui/ui.test.tsx
```

Expected: the disabled, danger, variant-distinctness and default tests fail. `Button` has no such props.

- [ ] **Step 3: Rewrite `src/ui/Button.tsx`**

```tsx
import type { ReactElement, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  onClick: () => void;
  children: ReactNode;
  /** Accessible name, for when `children` is an icon rather than text. */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}

/*
 * `text-bg` is the on-accent foreground in both directions, which is not a
 * coincidence worth losing: Paper's `bg` is white against a mid red, and Ink's
 * `bg` is near-black against a light coral. A literal white would fail in Ink.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  default: 'text-text hover:bg-hover',
  primary: 'bg-accent text-bg hover:opacity-90',
  danger: 'bg-danger text-bg hover:opacity-90',
  ghost: 'text-muted hover:bg-hover hover:text-text',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-1.5 text-ui-sm',
  md: 'h-7 px-2 text-ui',
};

export function Button({
  onClick,
  children,
  label,
  variant = 'default',
  size = 'md',
  disabled = false,
  className = '',
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--bear-duration-fast)] ease-bear disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
```

The per-component `focus-visible:outline-*` utilities are gone: Task 4's global `:focus-visible` rule covers this and every other element.

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/ui/ui.test.tsx
```

- [ ] **Step 5: Falsify**

1. Change `danger`'s `bg-danger` to `bg-accent`. Re-run. The danger test **must** redden. Restore.
2. Make `ghost` identical to `default`. Re-run. The variant-distinctness test **must** redden. Restore.
3. Remove `disabled={disabled}` from the element (keep the prop). Re-run. The disabled test **must** redden — if it does not, it is asserting only `opacity` and not real disablement. Restore.

- [ ] **Step 6: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/ui/Button.tsx src/ui/ui.test.tsx
git commit -m "feat(ui): Button variants, sizes, and a disabled state"
```

---

### Task 6: The `SidebarRow` primitive

**Files:**

- Create: `src/ui/SidebarRow.tsx`
- Modify: `src/ui/ui.test.tsx` (add a `SidebarRow` describe)

**Interfaces:**

- Consumes: Task 4's utilities.
- Produces:

```ts
export interface SidebarRowDisclosure {
  expanded: boolean;
  onToggle: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
}

export interface SidebarRowProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** Nesting level; each level indents. Defaults to 0. */
  depth?: number;
  /** Trailing count. Omit to render none. */
  count?: number;
  /** Leading glyph or icon. */
  icon?: ReactNode;
  /** Omit for a leaf row; a spacer keeps labels aligned with siblings. */
  disclosure?: SidebarRowDisclosure;
  /** `aria-current` value when selected. Defaults to 'page'. */
  current?: 'page' | 'true';
  children?: ReactNode;
}
```

Three consumers: M5's tag tree (Task 8), M6's smart lists, and M7's search results. Extracting it now rather than after M6 is the entire point of sequencing this milestone first — otherwise the tag row and the smart-list row get written twice and diverge.

It renders an `<li>` and expects to sit inside a `<ul>`. Nested children render as a `<ul>` inside the same `<li>`, which is how the tag tree nests today.

**Boundary:** `src/ui/` imports nothing from `src/app/`, `src/data/`, `src/features/`, or `src/i18n/`. `disclosure.label` is a prop precisely so this file never sees `useT`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/ui.test.tsx`. Add the import at the top of the file — `SidebarRowProps` is a type, so `verbatimModuleSyntax` requires it come in via `import type`:

```tsx
import { SidebarRow } from './SidebarRow';
import type { SidebarRowProps } from './SidebarRow';
```


```tsx
describe('SidebarRow', () => {
  const base = { label: 'Work', selected: false, onSelect: vi.fn() };

  function renderRow(props: Partial<SidebarRowProps> = {}) {
    return render(
      <ul>
        <SidebarRow {...base} {...props} />
      </ul>,
    );
  }

  it('selects on click', async () => {
    const onSelect = vi.fn();
    renderRow({ onSelect });

    await userEvent.click(screen.getByRole('button', { name: /Work/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the selected row with aria-current', () => {
    renderRow({ selected: true });
    expect(screen.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves an unselected row without aria-current', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /Work/ })).not.toHaveAttribute('aria-current');
  });

  it('honours an explicit aria-current value', () => {
    renderRow({ selected: true, current: 'true' });
    expect(screen.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-current', 'true');
  });

  it('renders a count when given one', () => {
    renderRow({ count: 12 });
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders a zero count rather than hiding it', () => {
    // `count && <span>` would swallow 0 and make an empty smart list look
    // like a list with an unknown size.
    renderRow({ count: 0 });
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders no count element when count is omitted', () => {
    const { container } = renderRow();
    expect(container.querySelectorAll('[data-count]')).toHaveLength(0);
  });

  it('exposes a labelled disclosure that toggles', async () => {
    const onToggle = vi.fn();
    renderRow({ disclosure: { expanded: false, onToggle, label: 'Toggle' } });

    const row = screen.getByRole('button', { name: /Work/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('omits aria-expanded on a leaf row', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /Work/ })).not.toHaveAttribute('aria-expanded');
  });

  it('indents by depth', () => {
    const { container } = renderRow({ depth: 2 });
    const row = screen.getByRole('button', { name: /Work/ });
    expect(row.getAttribute('style')).toContain('padding-left');
    expect(container).toBeTruthy();
  });

  it('renders nested children', () => {
    renderRow({
      children: (
        <ul>
          <SidebarRow label="Urgent" selected={false} onSelect={vi.fn()} />
        </ul>
      ),
    });

    expect(screen.getByRole('button', { name: /Urgent/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/ui/ui.test.tsx
```

Expected: fails to resolve the `SidebarRow` import.

- [ ] **Step 3: Create `src/ui/SidebarRow.tsx`**

```tsx
import type { ReactElement, ReactNode } from 'react';

export interface SidebarRowDisclosure {
  expanded: boolean;
  onToggle: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
}

export interface SidebarRowProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** Nesting level; each level indents. */
  depth?: number;
  /** Trailing count. Omit to render none. Zero renders as "0". */
  count?: number;
  /** Leading glyph or icon. */
  icon?: ReactNode;
  /** Omit for a leaf row; a spacer keeps labels aligned with siblings. */
  disclosure?: SidebarRowDisclosure;
  /** `aria-current` value when selected. */
  current?: 'page' | 'true';
  /** Nested rows, rendered inside this row's `<li>`. */
  children?: ReactNode;
}

const INDENT_REM = 0.75;

/**
 * One row of the sidebar: the shared shape behind the tag tree, M6's smart
 * lists, and M7's search results. Pure presentation — it knows nothing about
 * scopes, tags, or notes, which is what lets it live in `src/ui/`.
 *
 * Renders an `<li>` and expects a `<ul>` parent.
 */
export function SidebarRow({
  label,
  selected,
  onSelect,
  depth = 0,
  count,
  icon,
  disclosure,
  current = 'page',
  children,
}: SidebarRowProps): ReactElement {
  return (
    <li>
      <div className="flex items-center gap-1">
        {disclosure === undefined ? (
          // A spacer, not nothing: without it a leaf row's label sits one
          // control-width left of its siblings' labels.
          <span className="w-4 shrink-0" aria-hidden="true" />
        ) : (
          <button
            type="button"
            aria-label={disclosure.label}
            onClick={disclosure.onToggle}
            className="w-4 shrink-0 rounded-sm text-ui-xs text-faint transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-text"
          >
            {disclosure.expanded ? '▾' : '▸'}
          </button>
        )}

        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? current : undefined}
          aria-expanded={disclosure === undefined ? undefined : disclosure.expanded}
          style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
          className={`relative flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm pr-2 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
            selected ? 'bg-selected font-medium text-text' : 'text-text hover:bg-hover'
          }`}
        >
          {/*
            The accent edge marker. With the tinted `bg-selected` fill this is
            what makes selection read as MORE present than its surroundings —
            before M5.5 a selected row was `bg-bg`, i.e. a hole.
          */}
          {selected && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
            />
          )}

          {icon !== undefined && (
            <span aria-hidden="true" className="shrink-0 text-faint">
              {icon}
            </span>
          )}

          <span className="min-w-0 flex-1 truncate">{label}</span>

          {count !== undefined && (
            <span data-count className="shrink-0 text-ui-xs text-faint tabular-nums">
              {count}
            </span>
          )}
        </button>
      </div>

      {children}
    </li>
  );
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/ui/ui.test.tsx
```

- [ ] **Step 5: Falsify**

1. Change `{count !== undefined && …}` to `{count && …}`. Re-run. The zero-count test **must** redden. Restore — this is a real bug class: an empty smart list would render no count instead of `0`.
2. Delete the leaf-row spacer `<span className="w-4 …" />`. Re-run. No test reddens — that is expected and is a known limitation, since jsdom renders no layout. Restore it and note that alignment is verified by eye in Task 8.
3. Remove `aria-current={selected ? current : undefined}`. Re-run. Two tests **must** redden. Restore.
4. Add `import { useT } from '@/i18n';` to `SidebarRow.tsx` and use it. Re-run `npx vitest run scripts/sourceLint.test.ts`. The `src/ui` boundary test from Task 2 **must** redden — this is the assertion that keeps `disclosure.label` a prop rather than a translation lookup. Restore.

- [ ] **Step 6: Export it**

`src/ui/` has no barrel file today — `ui.test.tsx` imports each primitive by path and so do consumers. Follow that: no barrel.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/ui/SidebarRow.tsx src/ui/ui.test.tsx
git commit -m "feat(ui): SidebarRow, shared by the tag tree, smart lists and search"
```

---

### Task 7: `EmptyState` and `Resizer` onto the system

**Files:**

- Modify: `src/ui/EmptyState.tsx`
- Modify: `src/ui/Resizer.tsx:88-96` (the className and the inner span only)

**Interfaces:**

- Consumes: Task 4's utilities.
- Produces: no API change to either component. Props contracts are identical.

**Do not touch** `Resizer`'s pointer-capture handlers, its keyboard handler, its ARIA attributes, or the negative-margin trick — all four are load-bearing and carry findings recorded in comments. Only the two `className` strings change.

- [ ] **Step 1: Rewrite `src/ui/EmptyState.tsx`**

```tsx
import type { ReactElement } from 'react';

export function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-ui-lg font-semibold text-text">{title}</h2>
      <p className="max-w-xs text-ui text-muted">{body}</p>
    </div>
  );
}
```

- [ ] **Step 2: Update `Resizer`'s two className strings**

The hairline now widens as well as changing colour, and its transition moves onto the motion tokens. Replace the inner `<span>` only:

```tsx
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[background-color,width] duration-[var(--bear-duration-fast)] ease-bear group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent"
      />
```

Leave the outer `<div>`'s className exactly as it is, including `focus-visible:outline-none` — that outline is deliberately suppressed because the span above is this component's focus indicator, which is the documented exception to Task 4's global rule.

- [ ] **Step 3: Run the UI tests**

```bash
npx vitest run src/ui/ui.test.tsx
```

Expected: all pass unchanged. These tests assert roles, names and ARIA values, not class names, so a visual refactor must not move them. **If any test fails here, read it before changing anything** — a behavioural test failing during a pure restyle means the restyle changed behaviour.

- [ ] **Step 4: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/ui/EmptyState.tsx src/ui/Resizer.tsx
git commit -m "style(ui): EmptyState and Resizer onto the type and motion tokens"
```

---

### Task 8: `TagSidebar` adopts `SidebarRow`

**Files:**

- Modify: `src/features/tags/TagSidebar.tsx` (whole file)
- Modify: `src/features/tags/TagSidebar.test.tsx` if any assertion breaks

**Interfaces:**

- Consumes: `SidebarRow`, `SidebarRowProps` from Task 6.
- Produces: no prop-contract change to `TagSidebar`.

**Behaviour must not change.** The existing component renders `aria-current="page"` on a selected row, `aria-expanded` on a row with children, a disclosure button labelled `t('tags.toggle')`, a count, and `paddingLeft: depth * 0.75rem`. `SidebarRow` reproduces every one of these. The loading guard (`nodes === undefined` renders `null`, never an empty state) and the empty guard are untouched — both carry recorded findings.

- [ ] **Step 1: Run the existing tests and record the baseline**

```bash
npx vitest run src/features/tags/
```

Note the pass count. It must be identical at the end of this task.

- [ ] **Step 2: Rewrite `src/features/tags/TagSidebar.tsx`**

```tsx
import type { ReactElement } from 'react';

import { type NoteScope, scopeKey, tagScope } from '@/features/notes';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { SidebarRow } from '@/ui/SidebarRow';

import type { TagNode } from './tagTree';

export interface TagSidebarProps {
  /** `undefined` while the tree is loading. Renders nothing, never an empty state. */
  nodes: TagNode[] | undefined;
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  isCollapsed: (tag: string) => boolean;
  onToggle: (tag: string) => void;
}

interface RowProps extends Omit<TagSidebarProps, 'nodes'> {
  node: TagNode;
  depth: number;
}

function TagRow({ node, depth, scope, onScopeChange, isCollapsed, onToggle }: RowProps) {
  const t = useT();
  const hasChildren = node.children.length > 0;
  const collapsed = isCollapsed(node.tag);
  const selected = scopeKey(scope) === scopeKey(tagScope(node.tag));

  return (
    <SidebarRow
      label={node.label}
      count={node.count}
      depth={depth}
      selected={selected}
      onSelect={() => onScopeChange(tagScope(node.tag))}
      disclosure={
        hasChildren
          ? { expanded: !collapsed, onToggle: () => onToggle(node.tag), label: t('tags.toggle') }
          : undefined
      }
    >
      {hasChildren && !collapsed && (
        <ul>
          {node.children.map((child) => (
            <TagRow
              key={child.tag}
              node={child}
              depth={depth + 1}
              scope={scope}
              onScopeChange={onScopeChange}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </SidebarRow>
  );
}

export function TagSidebar({
  nodes,
  scope,
  onScopeChange,
  isCollapsed,
  onToggle,
}: TagSidebarProps): ReactElement | null {
  const t = useT();

  // `undefined` is "not loaded yet", not "no tags". Showing the empty state on
  // the first frame would flash "No tags yet" on every reload.
  if (nodes === undefined) return null;

  if (nodes.length === 0) {
    return <EmptyState title={t('sidebar.empty.title')} body={t('sidebar.empty.body')} />;
  }

  return (
    <nav aria-label={t('tags.label')} className="p-2">
      <ul>
        {nodes.map((node) => (
          <TagRow
            key={node.tag}
            node={node}
            depth={0}
            scope={scope}
            onScopeChange={onScopeChange}
            isCollapsed={isCollapsed}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </nav>
  );
}
```

**Note the inversion:** the old code passed `collapsed` and rendered `▸` when collapsed; `SidebarRow` takes `expanded`. `expanded: !collapsed` is the translation, and `aria-expanded` must still read `false` on a collapsed row. A test asserts this — if it reddens, the inversion is backwards.

- [ ] **Step 3: Run the tag tests**

```bash
npx vitest run src/features/tags/
```

Expected: the same pass count as Step 1. If a test fails on a class name, rewrite it to assert role/name/ARIA — the test is the defect. If a test fails on `aria-expanded`, the `expanded: !collapsed` inversion is wrong; fix the code.

- [ ] **Step 4: Falsify the inversion**

Change `expanded: !collapsed` to `expanded: collapsed`. Re-run. A test **must** redden. If none does, add one:

```tsx
it('reports a collapsed row as not expanded', () => {
  // ... render a tree with a collapsed parent ...
  expect(screen.getByRole('button', { name: /work/i })).toHaveAttribute('aria-expanded', 'false');
});
```

Restore the correct inversion.

- [ ] **Step 5: Verify alignment and selection by eye**

```bash
npm run dev
```

Create notes tagged `#work`, `#work/urgent`, and `#personal`. Confirm: leaf-row labels align with parent-row labels (Task 6's spacer); a selected row shows the tinted fill **and** the accent edge marker; counts are right-aligned and faint. Stop the server.

- [ ] **Step 6: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build
git add src/features/tags/
git commit -m "style(tags): tag tree onto SidebarRow

Selection now reads as a tinted fill plus an accent edge marker, rather
than bg-bg — which on a grey sidebar was less contrast than unselected."
```

---

### Task 9: `NoteList` and `NoteListItem`

**Files:**

- Modify: `src/features/notes/NoteList.tsx` (the header row's classNames and the `<ul>`)
- Modify: `src/features/notes/NoteListItem.tsx` (whole render)
- Modify: their tests if any assertion breaks

**Interfaces:**

- Consumes: Task 4's utilities, Task 5's `Button`.
- Produces: no prop-contract change to either component.

**Density rule for this surface:** row is `px-3 py-2.5`; title is `text-ui-md` semibold; date and snippet are `text-ui-sm`. The date is `text-faint`, the snippet `text-muted` — a timestamp is less important than a preview of the content.

- [ ] **Step 1: Rewrite `src/features/notes/NoteListItem.tsx`**

```tsx
import type { ReactElement } from 'react';

import type { Note } from '@/data';
import { useLocale, useT } from '@/i18n';

import { deriveSnippet, formatNoteDate } from './format';

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  /** The current time, for deciding whether a note's date renders as a time or a date. Defaults to the wall clock; tests pin it. */
  now?: number;
}

export function NoteListItem({ note, selected, onSelect, now }: NoteListItemProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const snippet = deriveSnippet(note.text);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`relative flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
          selected ? 'bg-selected' : 'hover:bg-hover'
        }`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
        )}

        <span className="truncate text-ui-md font-semibold text-text">
          {note.title === '' ? t('note.untitled') : note.title}
        </span>
        <span className="text-ui-sm text-faint">
          {formatNoteDate(note.updatedAt, locale, now ?? Date.now())}
        </span>
        <span className="truncate text-ui-sm text-muted">
          {snippet === '' ? t('note.noText') : snippet}
        </span>
      </button>
    </li>
  );
}
```

- [ ] **Step 2: Update `NoteList`'s header row**

In `src/features/notes/NoteList.tsx`, change only the toolbar `<div>`'s className. Leave every conditional, prop, and the `items === undefined` guard exactly as they are — that guard carries a recorded finding.

```tsx
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
```

`h-9` is 36px, the toolbar density rule. The `py-1` is dropped because the height is now explicit.

- [ ] **Step 3: Run the notes tests**

```bash
npx vitest run src/features/notes/
```

Expected: all pass. If one fails on a class name, rewrite it to assert `aria-current`, role, or text. If one fails on behaviour, stop — a restyle changed behaviour and that is a bug in this task.

- [ ] **Step 4: Falsify the selection marker**

Delete the `{selected && <span … bg-accent />}` block. Re-run `npx vitest run src/features/notes/`. Nothing reddens — jsdom renders no CSS, and `aria-current` still carries selection for assistive tech. Restore it, and record in the ledger that the marker's presence is verified by eye and by the e2e suite, not by a unit test.

- [ ] **Step 5: Run all six gates plus e2e, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
```

The e2e run matters here: the note list is the surface all four critical Playwright flows touch.

```bash
git add src/features/notes/
git commit -m "style(notes): note list density, type scale, and selection marker"
```

---

### Task 10: Editor toolbars, `InfoPanel`, and `UnavailableBanner`

**Files:**

- Modify: `src/features/editor/TopControls.tsx` (button classNames only)
- Modify: `src/features/editor/BottomToolbar.tsx` (container and button classNames only)
- Modify: `src/features/editor/InfoPanel.tsx:27` (one className)
- Modify: `src/app/UnavailableBanner.tsx` (classNames only)

**Interfaces:**

- Consumes: Task 4's utilities.
- Produces: nothing. No behaviour, props, or ARIA change anywhere in this task.

**Do not touch** any `onClick`, any `pinAllSelectionStep` call, any `aria-pressed` expression, or the `ACTIONS` table. `pinAllSelectionStep` prevents an unbounded document-growth bug and is verified in Playwright.

- [ ] **Step 1: `TopControls` — three button classNames**

All three buttons share a shape. Replace each button's className with the appropriate line:

```tsx
// Bold
className="h-7 rounded-sm px-2 text-ui font-bold text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"

// Italic
className="h-7 rounded-sm px-2 text-ui italic text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"

// Info
className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover"
```

And the container:

```tsx
className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-border px-4"
```

`hover:bg-hover` was already written here and did nothing, because `--color-hover` did not exist until Task 4. It works now.

- [ ] **Step 2: `BottomToolbar` — container and the one shared button className**

```tsx
// container
className="flex h-9 shrink-0 items-center gap-1 border-t border-border bg-bg px-4"

// each action button
className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:bg-selected aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"
```

The active state gains `aria-pressed:bg-selected` in addition to the existing colour change: a pressed toolbar toggle needs to be legible at a glance, and colour alone at 13px is not enough.

- [ ] **Step 3: `InfoPanel` — line 27**

```tsx
    <dl className="flex h-9 shrink-0 items-center gap-6 border-b border-border px-4 text-ui-sm text-faint">
```

Leave every `<dd className="text-text">` as it is: the values should stay at full contrast against faint labels.

- [ ] **Step 4: `UnavailableBanner`**

```tsx
    <div role="alert" className="border-b border-border bg-surface px-4 py-2 text-ui text-text">
      <p className="font-semibold">{t('database.memory.title')}</p>
      <p className="text-muted">{t('database.memory.body')}</p>
    </div>
```

- [ ] **Step 5: Run the editor tests, checking the exit code**

```bash
npx vitest run src/features/editor/ src/features/notes/NoteEditor.test.tsx
echo "exit=$?"
```

Expected: `exit=0`. **The exit code is the assertion here, not the pass count** — editor tests can print all-green and still exit 1 on an uncaught error from a missing jsdom stub.

- [ ] **Step 6: Run all six gates plus e2e, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/editor/ src/app/UnavailableBanner.tsx
git commit -m "style(editor): toolbars, info panel and banner onto the token system"
```

---

### Task 11: Write `DESIGN-bear-web.md`

**Files:**

- Create: `docs/design/DESIGN-bear-web.md`

**Interfaces:**

- Consumes: the final values in `src/styles/tokens.css`.
- Produces: the document a future contributor reads before touching a component.

Write it **last**, from the code as built, not from this plan. If the two disagree, the code is right and the plan drifted.

Follow the structure of `docs/design/DESIGN-discord.md`: YAML frontmatter carrying `colors`, `typography`, `rounded`, `spacing`, `components` — with component values written as token *references* like `"{colors.accent}"` — then prose sections, ending in Do's and Don'ts.

- [ ] **Step 1: Measure the contrast ratios by hand**

The suite cannot assert these: computing WCAG contrast for alpha-composited overlays over three surfaces in two themes needs a real cascade, and jsdom has none.

Use any contrast checker on these pairs, in **both** Paper and Ink:

| Foreground     | Background       | Target       |
| -------------- | ---------------- | ------------ |
| `text`         | `bg`             | ≥ 7.0 (AAA)  |
| `text`         | `sidebar`        | ≥ 7.0        |
| `muted`        | `surface`        | ≥ 4.5 (AA)   |
| `faint`        | `sidebar`        | ≥ 3.0        |
| `bg`           | `accent`         | ≥ 4.5        |
| `accent`       | `sidebar`        | ≥ 3.0        |

Record every measured ratio in the design doc. **If any pair misses its target, adjust the token in `tokens.css` and re-measure** — do not record a failing ratio as acceptable. `faint` at 3.0 is the likely tight one; it carries counts and timestamps, which are supplementary, hence the lower bar.

- [ ] **Step 2: Write the frontmatter**

Transcribe the real values from `tokens.css`. Include a `components` map covering `sidebar-row`, `note-list-row`, `toolbar`, `toolbar-button`, `button-default`, `button-primary`, `button-danger`, `button-ghost`, `empty-state`, and `dialog` — the last describing what M6 will build, so M6 has a spec to hit rather than a blank page.

- [ ] **Step 3: Write the prose sections**

Cover, in order: Overview (the one-paragraph mood statement — quiet, warm greyscale, one red, type-led), Colors (with the measured ratios), Typography (the UI scale, and that editor type is separate and M8-owned), Layout (the density rules table from the spec, and why there are no spacing tokens), Motion, Shapes, Components, and Do's and Don'ts.

The Don'ts must include, each with its reason:

- Don't write a colour literal in a component — `scripts/sourceLint.test.ts` fails the build.
- Don't add a themed token to only one of the two dark blocks — `scripts/sourceLint.test.ts` fails the build.
- Don't simplify `:root:not([data-theme='light'])` — it is M8's seam.
- Don't introduce spacing tokens; Tailwind's default scale is already a 4px grid, and a second scale creates a standing question about which to reach for.
- Don't reach for `accent` where you mean `danger` — they are the same colour today and will not be in every M8 theme.
- Don't write a per-component transition duration; use the tokens, so `prefers-reduced-motion` keeps covering everything.
- Don't set `outline-none` without supplying a visible focus indicator.

- [ ] **Step 4: Commit**

```bash
npm run format
git add docs/design/DESIGN-bear-web.md src/styles/tokens.css
git commit -m "docs(design): the bear-web design language, with measured contrast"
```

---

### Task 12: Update `CLAUDE.md` and close the branch

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the status table**

Insert a row for M5.5 between M5 and M6, marked complete. Update the test counts to the real numbers from `npm test`.

- [ ] **Step 2: Add the new rules**

Under "Rules that must not be silently reversed", add entries for:

- **The font family names are `'Pretendard Variable'` and `'JetBrains Mono Variable'`.** The npm packages register those exact strings. `tokens.css` named `'Pretendard'` from M2 until M5.5 with no `@font-face` anywhere, so the app silently ran on `system-ui` for five milestones. Merely importing the package would not have fixed it — the family name has to match too. `scripts/fonts.test.ts` compares the token's family against the families the shipped stylesheet declares, which is the only form of this assertion that can fail.
- **Colour literals outside `tokens.css` fail the build**, via `scripts/sourceLint.test.ts`. The scan is a documented heuristic scoped to CSS files and `className`/`style` regions, because `#face` and `#dad` are valid hex and valid tags.
- **The architecture boundaries are now tested, not merely stated.** Before M5.5 the only trace of the `src/ui` rule in the codebase was a comment in `ui.test.tsx`; oxlint has no import-restriction rule, so a violating import would have worked silently. `scripts/sourceLint.test.ts` checks `@/`-aliased imports out of `src/ui`, `src/lib` and `src/data`. Relative imports cannot cross these boundaries, which is why only the alias is matched. **This does not cover the `markdown.ts` single-importer convention**, which remains enforced by nothing — a second importer of `@tiptap/markdown` would still just work.
- **Only `Resizer` may set `outline-none`**, because its accent hairline is its own focus indicator. `scripts/sourceLint.test.ts` pins the exception list to exactly that one file, so a second suppressor fails the build rather than silently becoming unfocusable.
- **Both dark theme blocks must stay token-for-token identical**, asserted by the same file. A token present in `:root[data-theme='dark']` but missing from the `prefers-color-scheme` block is correct for a user who picked dark and wrong for a user whose OS is dark — invisible to every other test.
- **Motion lives in two duration tokens, never per-component**, so one `prefers-reduced-motion` block covers animations added later.
- **`danger` and `focus` are separate tokens from `accent`** even though all three are the same colour in both shipped themes. An M8 theme with a green accent must not get a green delete button.
- **Tailwind v4 has no `--duration-*` theme namespace.** Durations are written `duration-[var(--bear-duration-fast)]`. Adding a `--duration-fast` theme key does not produce a `duration-fast` utility.
- **Source-scanning tests live in `scripts/`, not `src/`.** `tsconfig.app.json` deliberately omits Node types so a `process.env` under `src/` fails typecheck; `tsconfig.node.json` already includes `scripts`.

- [ ] **Step 3: Add to "Toolchain surprises"**

- **`--color-hover` did not exist until M5.5**, so `hover:bg-hover` — written in `TopControls` and `BottomToolbar` since M4 — generated no class and those buttons had no hover state. Tailwind v4 silently emits nothing for a utility whose theme key is absent; it is not an error.

- [ ] **Step 4: Run every gate one final time**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
```

All six must pass. Record the final unit and e2e counts.

- [ ] **Step 5: Commit and merge**

```bash
git add CLAUDE.md
git commit -m "docs: record the M5.5 design language rulings"
git checkout main
git merge --no-ff m5.5-design-language
```

Do not push. The user decides when to push.

---

## Verification checklist for the whole-branch review

- [ ] Fonts load in a real browser — check DevTools Network for `.woff2` requests and confirm the computed `font-family` on `body` resolves to `Pretendard Variable`, not `system-ui`.
- [ ] Both themes render correctly: force `data-theme="dark"` on `<html>`, then remove it and toggle the OS setting to confirm the media-query path independently.
- [ ] `prefers-reduced-motion` actually disables transitions — enable it in DevTools rendering options and confirm hover fills snap.
- [ ] Every measured contrast ratio in `DESIGN-bear-web.md` matches the shipped tokens.
- [ ] Keyboard-only pass: tab through sidebar, list, toolbars, and resizers; every focused element shows a visible ring.
- [ ] No behaviour changed — the e2e suite is the evidence, and its count must equal the pre-branch count of 18.
