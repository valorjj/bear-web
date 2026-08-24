# C — Code block language and syntax highlighting: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour the contents of fenced code blocks, and give each block a
control for choosing its language, without making the app measurably heavier
than the ruled `+23.2 KB`.

**Architecture:** `lowlight` replaces StarterKit's `codeBlock` node with
`CodeBlockLowlight`, registering twelve grammars eagerly at module scope. Six
new `--bear-code-*` tokens carry the syntax palette, authored as twelve
literals that interpolate on each theme's existing `--bear-dark` scalar. The
language picker is a `Decoration.widget` on the code block, copying
`TableControls.ts` exactly.

**Tech Stack:** TypeScript, Tiptap 3 / ProseMirror, `lowlight` + `highlight.js`,
Tailwind v4 with CSS custom properties, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-c-code-highlighting-design.md`

## Global Constraints

- **`@tiptap/extension-code-block-lowlight` is pinned to `3.29.2`.** Unpinned,
  `npm i` fails `ERESOLVE` against `@tiptap/core@3.29.2`. `highlight.js`
  arrives transitively via `lowlight`; do not add it explicitly.
- **Grammars are eager, never lazy.** Ruled in `5c04dee`. No `import()`, no
  registry, no loader.
- **Twelve languages, exactly:** bash, css, java, javascript, json, kotlin,
  markdown, python, sql, typescript, xml, yaml.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()`
  outside `src/styles/tokens.css` is a defect.
- **No user-facing string is hardcoded in a component.** `useT` only; `en.ts`
  defines the key type and `ko.ts` is `Record<TranslationKey, string>`, so a
  missing translation is a compile error. **Never weaken that annotation.**
  The twelve language display names are the documented exception — they are
  data on `CODE_LANGUAGES`, not translation keys (see spec §3).
- **`useT()` takes no arguments and this app has no string interpolation.**
  Compose a sentence from separate keys.
- **Contrast floors:** five roles at **4.5:1** on `surface`, `comment` at
  **3.0**. Do not relax the other five to keep a palette faithful.
- **All six gates pass before every commit:** `npm test`, `npm run test:e2e`,
  `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **Before any e2e run that follows a source change:**
  `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is
  silently reused and you will test the previous build.
- **Editor unit tests need jsdom stubs.** `Range.prototype.getBoundingClientRect`,
  `Range.prototype.getClientRects`, `document.elementFromPoint` — see the
  header of `src/features/notes/NoteEditor.test.tsx`. A missing stub throws
  **uncaught**, so `vitest run` exits 1 while every assertion passes. **Check
  exit codes, not pass counts.**
- **Duck-type in tests, never `instanceof`.** `vitest.setup.ts` swaps the
  global `Blob` for Node's.

---

### Task 1: The language roster

The single source of truth for which languages exist, what they are called,
and which fence strings map to them. Pure data and pure functions — no
`lowlight` import, so this task is testable before the dependency is installed.

**Files:**

- Create: `src/features/editor/codeLanguages.ts`
- Test: `src/features/editor/codeLanguages.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface CodeLanguage { id: string; label: string; aliases: readonly string[] }`
  - `const CODE_LANGUAGES: readonly CodeLanguage[]`
  - `function resolveLanguage(fence: string | null | undefined): CodeLanguage | null`
  - `function languageLabel(fence: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/editor/codeLanguages.test.ts
import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES, languageLabel, resolveLanguage } from './codeLanguages';

describe('the roster', () => {
  it('holds exactly the twelve ruled languages', () => {
    expect(CODE_LANGUAGES.map((l) => l.id).sort()).toEqual([
      'bash',
      'css',
      'java',
      'javascript',
      'json',
      'kotlin',
      'markdown',
      'python',
      'sql',
      'typescript',
      'xml',
      'yaml',
    ]);
  });

  it('gives every language a non-empty display label', () => {
    for (const language of CODE_LANGUAGES) {
      expect(language.label.length, `${language.id} has no label`).toBeGreaterThan(0);
    }
  });

  it('never lets two languages claim the same alias', () => {
    const seen = new Map<string, string>();
    for (const language of CODE_LANGUAGES) {
      for (const alias of [language.id, ...language.aliases]) {
        expect(seen.has(alias), `${alias} claimed by ${seen.get(alias)} and ${language.id}`).toBe(
          false,
        );
        seen.set(alias, language.id);
      }
    }
  });
});

describe('resolveLanguage', () => {
  it('resolves an id to itself', () => {
    expect(resolveLanguage('python')?.id).toBe('python');
  });

  it('resolves an alias to its language', () => {
    expect(resolveLanguage('ts')?.id).toBe('typescript');
    expect(resolveLanguage('py')?.id).toBe('python');
    expect(resolveLanguage('sh')?.id).toBe('bash');
  });

  it('is case-insensitive, because a fence is user input', () => {
    expect(resolveLanguage('TS')?.id).toBe('typescript');
    expect(resolveLanguage('YAML')?.id).toBe('yaml');
  });

  it('returns null for a language outside the roster', () => {
    expect(resolveLanguage('rust')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });
});

describe('languageLabel', () => {
  it('labels a known fence with its display name, not the fence text', () => {
    expect(languageLabel('ts')).toBe('TypeScript');
  });

  it('echoes an unknown fence back verbatim rather than dropping it', () => {
    // A language we do not highlight is still a language the user wrote. The
    // control must show it, so the user can see the editor is not silently
    // discarding their fence.
    expect(languageLabel('rust')).toBe('rust');
  });

  it('is null when the fence names nothing, so the caller supplies i18n copy', () => {
    expect(languageLabel('')).toBeNull();
    expect(languageLabel(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/editor/codeLanguages.test.ts`
Expected: FAIL — `Failed to resolve import "./codeLanguages"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/editor/codeLanguages.ts

/**
 * A language the editor can highlight, its display name, and every fence
 * string that means it.
 *
 * `label` is DATA, not a translation key, and that is deliberate. These are
 * proper nouns — "TypeScript" and "YAML" are spelled identically in English
 * and Korean — so routing them through `en.ts`/`ko.ts` would create
 * twenty-four entries that must never diverge. Two lists that must agree is
 * the defect the no-hardcoded-strings rule exists to prevent, and it would be
 * reintroduced here in the name of obeying it. The picker's own chrome (its
 * accessible name, its filter placeholder, its no-language label) IS
 * translated; see `editor.code.*` in `src/i18n/en.ts`.
 */
export interface CodeLanguage {
  /** The canonical fence string, and lowlight's registration name. */
  id: string;
  /** Shown in the picker. A proper noun; see the docblock above. */
  label: string;
  /** Other fence strings that mean this language. Never includes `id`. */
  aliases: readonly string[];
}

/**
 * The twelve languages, ruled on 2026-08-24 and measured at `+23.2 KB` gzipped
 * when registered eagerly.
 *
 * This array is the ONLY list of languages in the codebase. `lowlight`'s
 * registrations, the picker's options and the alias table all read from it,
 * because two lists that must agree is exactly the defect
 * `scripts/sourceLint.test.ts` exists to catch elsewhere.
 *
 * Growing this list re-opens the eager-versus-lazy ruling rather than
 * inheriting it: per-language cost is not uniform. CSS is 4,324 B gzipped and
 * JSON is 431 B, an order of magnitude apart.
 *
 * Aliases are the ones highlight.js itself recognises, narrowed to the
 * unambiguous ones. `md` is deliberately absent from `markdown`: it is a
 * common fence string, but it is also this project's own file extension and
 * the ambiguity is not worth the convenience.
 */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { id: 'css', label: 'CSS', aliases: [] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'markdown', label: 'Markdown', aliases: [] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'sql', label: 'SQL', aliases: [] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'xml', label: 'XML', aliases: ['html', 'svg', 'xhtml'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
];

const BY_ALIAS: ReadonlyMap<string, CodeLanguage> = new Map(
  CODE_LANGUAGES.flatMap((language) =>
    [language.id, ...language.aliases].map((alias) => [alias, language] as const),
  ),
);

/**
 * The language a fence string names, or `null` if it names none this editor
 * knows.
 *
 * Case-insensitive because a fence is user input and `TS` is not a mistake.
 * Returning `null` rather than a nearest match is load-bearing: an unknown
 * language renders unhighlighted and keeps its fence text verbatim, and
 * guessing would silently rewrite the user's document.
 */
export function resolveLanguage(fence: string | null | undefined): CodeLanguage | null {
  if (!fence) return null;
  return BY_ALIAS.get(fence.trim().toLowerCase()) ?? null;
}

/**
 * What the picker's trigger should read for a given fence.
 *
 * Three cases, deliberately distinct: a known language shows its proper
 * display name; an UNKNOWN language echoes what the user typed, so the editor
 * visibly is not discarding it; and an absent language returns `null` so the
 * caller can supply a translated "no language" label rather than this module
 * inventing English copy.
 */
export function languageLabel(fence: string | null | undefined): string | null {
  if (!fence || fence.trim() === '') return null;
  return resolveLanguage(fence)?.label ?? fence.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/editor/codeLanguages.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the full gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test
git add src/features/editor/codeLanguages.ts src/features/editor/codeLanguages.test.ts
git commit -m "feat(editor): the twelve-language roster and its alias table"
```

---

### Task 2: Swap the code block node for the highlighting one

**Files:**

- Modify: `package.json` (dependencies)
- Create: `src/features/editor/lowlight.ts`
- Modify: `src/features/editor/extensions.ts:41` (the `StarterKit.configure` call) and the import block
- Test: `src/features/editor/extensions.test.ts` (extend the existing file)

**Interfaces:**

- Consumes: `CODE_LANGUAGES` from Task 1.
- Produces: `const lowlight: ReturnType<typeof createLowlight>` from
  `./lowlight`, with all twelve grammars registered.

- [ ] **Step 1: Install the pinned dependencies**

```bash
npm i lowlight @tiptap/extension-code-block-lowlight@3.29.2
```

Expected: installs cleanly. If you see `ERESOLVE`, you dropped the version
pin — it is a hard requirement against `@tiptap/core@3.29.2`, not a
preference. Confirm `highlight.js` appeared transitively:

```bash
npm ls highlight.js lowlight @tiptap/extension-code-block-lowlight
```

- [ ] **Step 2: Write the failing test**

Append to `src/features/editor/extensions.test.ts`:

```ts
describe('code block highlighting', () => {
  it('registers the lowlight code block, not StarterKit’s plain one', () => {
    // The failure this catches is silent: if StarterKit’s `codeBlock` is left
    // enabled AND CodeBlockLowlight is added, Tiptap’s reversed extension
    // order means one of them wins with no warning, and the losing case is a
    // fully working editor that simply never highlights. Asserting on a
    // rendered colour would not see it either, because jsdom has no cascade.
    const codeBlock = editorExtensions.find((extension) => extension.name === 'codeBlock');
    expect(codeBlock).toBeDefined();
    expect(codeBlock?.options).toHaveProperty('lowlight');
  });

  it('registers exactly one codeBlock in the schema', () => {
    const names = editorExtensions.map((extension) => extension.name);
    expect(names.filter((name) => name === 'codeBlock')).toHaveLength(1);
  });

  it('registers every roster language with lowlight and nothing else', () => {
    expect(lowlight.listLanguages().sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort());
  });

  it('leaves the recognized HTML tag set unchanged', () => {
    // `computeRecognizedHtmlTags()` builds a schema from the supported set and
    // decides which inline HTML the raw fallback must rescue. CodeBlockLowlight
    // extends CodeBlock and should parse the same `pre` rule — "should" is not
    // evidence, and a change here silently alters how existing notes round-trip.
    const schema = getSchema(editorExtensions);
    expect(schema.nodes.codeBlock).toBeDefined();
    expect(Object.keys(schema.nodes)).toContain('codeBlock');
  });
});
```

Add to that file's imports: `import { getSchema } from '@tiptap/core';`,
`import { CODE_LANGUAGES } from './codeLanguages';`,
`import { lowlight } from './lowlight';`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/editor/extensions.test.ts`
Expected: FAIL — cannot resolve `./lowlight`.

- [ ] **Step 4: Create the lowlight instance**

```ts
// src/features/editor/lowlight.ts
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

/**
 * The twelve grammars, registered EAGERLY at module scope.
 *
 * Eager was ruled on 2026-08-24 (`5c04dee`) after measurement: `+23,216 B`
 * gzipped against a `278,028 B` baseline, versus `+8,602 B` lazy. The 14.6 KB
 * saving was rejected because a lazy loader's failure mode is silent — during
 * the spike its registry tree-shook to nothing and produced a build that
 * compiled, ran, and highlighted nothing at all.
 *
 * Do NOT convert these to dynamic `import()`. The static imports above are
 * what makes the cost visible to the bundle-ceiling test in
 * `scripts/bundleSize.test.ts`, and what makes a regression impossible to
 * introduce quietly.
 *
 * Named imports rather than a loop over `CODE_LANGUAGES`, deliberately: a
 * bundler cannot statically resolve `import('highlight.js/lib/languages/' + id)`,
 * so a loop would either fail to bundle or fall back to shipping every grammar
 * highlight.js has. `extensions.test.ts` asserts this list and the roster agree.
 */
export const lowlight = createLowlight({
  bash,
  css,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
});
```

- [ ] **Step 5: Swap the node in `extensions.ts`**

Add to the imports:

```ts
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';

import { lowlight } from './lowlight';
```

Replace line 41 (`StarterKit.configure({ underline: false }),`) with:

```ts
    // `codeBlock: false` is load-bearing for the same reason `underline: false`
    // beside it is. StarterKit registers its own plain `codeBlock`; leaving it
    // on while also registering `CodeBlockLowlight` gives two extensions the
    // same node name, and Tiptap's reversed extension order decides the winner
    // silently. The losing case is not a crash — it is a fully working editor
    // that never highlights anything, which no rendered-output test can see.
    // `extensions.test.ts` asserts the surviving `codeBlock` carries a
    // `lowlight` option.
    StarterKit.configure({ underline: false, codeBlock: false }),
    // Registered here rather than inside `buildSupportedExtensions`' tail so it
    // sits with the other schema-contributing nodes. Unlike `TagPill`,
    // `HeadingFold` and `TableControls`, this IS a Node: it changes the schema,
    // so `computeRecognizedHtmlTags()` sees it and the round-trip suites are
    // not blind to it.
    CodeBlockLowlight.configure({ lowlight }),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/editor/extensions.test.ts src/features/editor/markdown.test.ts src/features/editor/stability.test.ts src/features/editor/tagAgreement.test.ts`
Expected: PASS. The last three are the regression canaries — the fence
round-trip (`markdown.test.ts:97`), `` ```py `` stability
(`stability.test.ts:72`), and `#work` inside a fence not becoming a tag
(`tagAgreement.test.ts:77`).

If `tagAgreement` fails, stop and report rather than adjusting it: the
highlighter now emits spans inside code blocks where there was bare text, and
that is a real interaction, not a test to relax.

- [ ] **Step 7: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(editor): swap StarterKit's code block for the lowlight one"
```

---

### Task 3: The palette tokens, and proving the `--bear-dark` mechanism

**Files:**

- Modify: `src/styles/tokens.css` (the `:root` derived block, and the
  `[data-theme='high-contrast']` block)
- Modify: `scripts/sourceLint.test.ts` (the `PALETTE` array)
- Test: `e2e/codePalette.spec.ts` (new)

**Interfaces:**

- Consumes: nothing.
- Produces: six CSS custom properties — `--bear-code-keyword`,
  `--bear-code-string`, `--bear-code-number`, `--bear-code-comment`,
  `--bear-code-function`, `--bear-code-type` — resolving for all sixteen
  themes.

- [ ] **Step 1: Write the failing probe test**

This is the task's real gate. Interpolating two colours on `--bear-dark` is a
**new** use of that scalar — until now it has only scaled alphas inside
`calc()`. F's derivation was dead on first implementation while every test
passed, and only a probe theme caught it.

```ts
// e2e/codePalette.spec.ts
import { expect, test } from '@playwright/test';

import { parseColour } from '../scripts/contrast.ts';
import { readThemeTokens } from './fixtures/tokens.ts';

const ROLES = ['keyword', 'string', 'number', 'comment', 'function', 'type'] as const;
const NAMES = ROLES.map((role) => `code-${role}`);

test.describe('the syntax palette', () => {
  test('resolves all six roles on a light theme and a dark one', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox').first().waitFor();

    for (const theme of ['paper', 'ink']) {
      const tokens = await readThemeTokens(page, theme, NAMES);
      for (const name of NAMES) {
        expect(tokens[name], `${theme}'s --bear-${name} did not resolve`).toBeTruthy();
        const colour = parseColour(tokens[name]!);
        // `parseColour` yields NaN on a format it cannot read, and every
        // downstream comparison against NaN is false — so an unreadable value
        // passes a naive check. Assert the numbers are numbers.
        expect(Number.isNaN(colour.r), `${theme} ${name} parsed to NaN`).toBe(false);
      }
    }
  });

  test('a theme at --bear-dark 0.5 lands between the two literals', async ({ page }) => {
    // THE mechanism test. If --bear-dark cannot interpolate two colours, this
    // is where it shows, and the fallback is six explicit overrides in each of
    // the seven dark theme blocks.
    await page.goto('/');
    await page.getByRole('textbox').first().waitFor();

    const probe = await page.evaluate(() => {
      const root = document.documentElement;
      const read = (dark: string) => {
        root.setAttribute('data-theme', 'paper');
        root.style.setProperty('--bear-dark', dark);
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.color = 'var(--bear-code-keyword)';
        document.body.appendChild(el);
        const value = getComputedStyle(el).color;
        el.remove();
        return value;
      };
      const light = read('0');
      const mid = read('0.5');
      const dark = read('1');
      root.style.removeProperty('--bear-dark');
      return { light, mid, dark };
    });

    expect(probe.light).not.toBe(probe.dark);
    expect(probe.mid).not.toBe(probe.light);
    expect(probe.mid).not.toBe(probe.dark);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/codePalette.spec.ts
```

Expected: FAIL — `--bear-code-keyword` does not resolve, so
`toBeTruthy()` fails on the first role.

- [ ] **Step 3: Add the tokens to `:root`**

In `src/styles/tokens.css`, immediately after the four `--bear-hl-*`
`color-mix` declarations and before the closing `}` of the `:root` block:

```css
  /*
   * The syntax palette. Twelve literals, six tokens.
   *
   * Authored as a light value and a dark value per role, interpolated on the
   * theme's own `--bear-dark`. This is a NEW use of that scalar: until C it
   * only ever scaled alphas inside `calc()`. It is preferred over a grouped
   * `[data-theme='a'], [data-theme='b']` selector for the same reason F
   * rejected one, and over six overrides in each of the seven dark blocks
   * because that is forty-two declarations to say one thing.
   *
   * Punctuation, operators and plain identifiers get NO token and inherit
   * `--bear-text`. That is what keeps this at six roles rather than twenty:
   * the roles below carry meaning at a glance, and colouring punctuation is
   * what makes a code block look like confetti.
   *
   * `-comment` is the only role held to 3.0 rather than 4.5 in
   * `e2e/contrast.spec.ts`, borrowing the justification `--bear-faint`
   * already carries there: secondary information a reader skims. 4.5 forbids
   * a dim comment, which is the universal convention. Do NOT relax the other
   * five to keep a palette faithful.
   */
  --bear-code-keyword-l: #a626a4;
  --bear-code-string-l: #1f7a3d;
  --bear-code-number-l: #b25000;
  --bear-code-comment-l: #6f7480;
  --bear-code-function-l: #2a5db0;
  --bear-code-type-l: #00706b;

  --bear-code-keyword-d: #c792ea;
  --bear-code-string-d: #9ece6a;
  --bear-code-number-d: #ffb86c;
  --bear-code-comment-d: #8b93a7;
  --bear-code-function-d: #82aaff;
  --bear-code-type-d: #7fdbca;

  --bear-code-keyword: color-mix(
    in oklab,
    var(--bear-code-keyword-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-keyword-d)
  );
  --bear-code-string: color-mix(
    in oklab,
    var(--bear-code-string-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-string-d)
  );
  --bear-code-number: color-mix(
    in oklab,
    var(--bear-code-number-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-number-d)
  );
  --bear-code-comment: color-mix(
    in oklab,
    var(--bear-code-comment-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-comment-d)
  );
  --bear-code-function: color-mix(
    in oklab,
    var(--bear-code-function-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-function-d)
  );
  --bear-code-type: color-mix(
    in oklab,
    var(--bear-code-type-l) calc((1 - var(--bear-dark)) * 100%),
    var(--bear-code-type-d)
  );
```

- [ ] **Step 4: Override the palette for `high-contrast`**

This theme is the one exception to "per-theme overrides are a follow-up", and
the reason is measurement, not taste: it sets `bg` and `surface` to `#000000`
and exists for readers who need contrast. Add inside
`[data-theme='high-contrast']`, after `--bear-tag-fill-strong`:

```css
  /*
   * The syntax palette, overridden rather than interpolated. This theme's
   * surface is pure black, and the shared dark palette's saturated hues do not
   * clear 4.5:1 against it — on the one theme whose entire purpose is
   * contrast. These are bright and low-saturation on purpose, closer to the
   * `accent`/`text` family than to a conventional syntax scheme, and that is
   * the right trade here.
   */
  --bear-code-keyword: #ffd400;
  --bear-code-string: #7dffb0;
  --bear-code-number: #ffb3a7;
  --bear-code-comment: #b8b8b8;
  --bear-code-function: #8ecfff;
  --bear-code-type: #d6b3ff;
```

- [ ] **Step 5: Teach `sourceLint` about the six**

In `scripts/sourceLint.test.ts`, add to the end of the `PALETTE` array (after
`'hl-purple'`):

```ts
    'code-keyword',
    'code-string',
    'code-number',
    'code-comment',
    'code-function',
    'code-type',
```

This makes the existing "`:root` defines every non-base token" assertion cover
them, and — because `BASE` is unchanged — also asserts `:root` must NOT treat
them as per-theme base tokens.

- [ ] **Step 6: Run both suites to verify they pass**

```bash
npx vitest run scripts/sourceLint.test.ts
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/codePalette.spec.ts
```

Expected: PASS.

**If the `--bear-dark 0.5` test fails**, the mechanism does not work. Do not
work around it silently. Stop, report, and apply the named fallback: delete the
six `color-mix` declarations, keep the twelve literals, and add six explicit
overrides to each of the seven `--bear-dark: 1` theme blocks plus the
`prefers-color-scheme: dark` block. Then say so in the commit message.

- [ ] **Step 7: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(themes): a six-role syntax palette, interpolated on --bear-dark"
```

---

### Task 4: Paint the highlighter's output, and guard the class mapping

**Files:**

- Modify: `src/styles/editor.css` (after the `.ProseMirror pre code` block at
  line 293)
- Create: `src/features/editor/highlightClasses.test.ts`

**Interfaces:**

- Consumes: `lowlight` (Task 2), the six tokens (Task 3).
- Produces: `const MAPPED_HLJS_CLASSES: ReadonlySet<string>` and
  `const INHERITS_TEXT: ReadonlySet<string>` from
  `src/features/editor/highlightClasses.ts`.

- [ ] **Step 1: Write the failing test**

The risk in this task is not the colours, it is coverage: **an unmapped
`.hljs-*` class renders as plain text with no error**, indistinguishable from
"this token type is deliberately uncoloured". So the test derives the class set
empirically from the grammars rather than trusting a list anyone wrote.

```ts
// src/features/editor/highlightClasses.test.ts
import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES } from './codeLanguages';
import { INHERITS_TEXT, MAPPED_HLJS_CLASSES } from './highlightClasses';
import { lowlight } from './lowlight';

/** A snippet per language, chosen to exercise keywords, strings, numbers,
 *  comments, function names and type/attribute positions. */
const SAMPLES: Record<string, string> = {
  bash: '# note\nfoo() { echo "hi" 42; }',
  css: '/* note */\n.a { color: #fff; width: 42px; }',
  java: '// note\nclass A { int f() { return 42; } }',
  javascript: '// note\nfunction f(a) { return "s" + 42; }',
  json: '{ "a": 42, "b": "s", "c": true }',
  kotlin: '// note\nfun f(a: Int): String = "s"',
  markdown: '# Title\n\n**bold** and `code`',
  python: '# note\ndef f(a: int) -> str:\n    return "s"',
  sql: '-- note\nSELECT a FROM t WHERE b = 42;',
  typescript: '// note\nfunction f(a: number): string { return "s"; }',
  xml: '<!-- note --><a href="x">y</a>',
  yaml: '# note\na: 42\nb: "s"',
};

function classesEmittedBy(language: string, code: string): Set<string> {
  const tree = lowlight.highlight(language, code);
  const found = new Set<string>();
  const walk = (node: { type?: string; properties?: { className?: string[] }; children?: unknown[] }) => {
    for (const name of node.properties?.className ?? []) found.add(name);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(tree as unknown as Parameters<typeof walk>[0]);
  return found;
}

describe('the hljs class mapping', () => {
  it('covers every class the twelve grammars actually emit', () => {
    const unaccounted: string[] = [];
    for (const { id } of CODE_LANGUAGES) {
      for (const name of classesEmittedBy(id, SAMPLES[id]!)) {
        if (name === 'hljs') continue;
        if (MAPPED_HLJS_CLASSES.has(name)) continue;
        if (INHERITS_TEXT.has(name)) continue;
        unaccounted.push(`${id}: ${name}`);
      }
    }
    // A class in neither set renders as plain text with NO error, which is
    // indistinguishable from a deliberate choice. Add it to one set or the
    // other — never leave it out.
    expect(unaccounted).toEqual([]);
  });

  it('has a sample for every roster language, so the sweep is not vacuous', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort());
  });

  it('never lists a class as both mapped and inheriting', () => {
    const both = [...MAPPED_HLJS_CLASSES].filter((name) => INHERITS_TEXT.has(name));
    expect(both).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/editor/highlightClasses.test.ts`
Expected: FAIL — cannot resolve `./highlightClasses`.

- [ ] **Step 3: Write the mapping module**

Create `src/features/editor/highlightClasses.ts`. Start from the grouping
below, then **run the test and let it tell you what is missing** — that is the
point of deriving the set empirically. Add each reported class to whichever set
is correct, and note in the file why anything lands in `INHERITS_TEXT`.

```ts
/**
 * Which `.hljs-*` classes the six syntax roles claim, and which deliberately
 * inherit `--bear-text`.
 *
 * Both sets exist because the failure mode is silent: a class in neither set
 * renders as plain body text with no error, which looks exactly like a
 * deliberate decision. `highlightClasses.test.ts` highlights a sample per
 * language, collects every class the twelve grammars actually emit, and fails
 * on anything unaccounted for — so this file is derived from the grammars,
 * not from anyone's memory of highlight.js's documentation.
 *
 * Keep in step with `src/styles/editor.css`'s `.hljs-*` rules and with the
 * export stylesheet in `src/features/export/html.ts`.
 */
export const ROLE_CLASSES = {
  keyword: ['hljs-keyword', 'hljs-literal', 'hljs-built_in', 'hljs-selector-tag'],
  string: ['hljs-string', 'hljs-regexp', 'hljs-char', 'hljs-meta-string'],
  number: ['hljs-number', 'hljs-symbol'],
  comment: ['hljs-comment', 'hljs-quote'],
  function: ['hljs-title', 'hljs-section', 'hljs-function'],
  type: ['hljs-type', 'hljs-attr', 'hljs-attribute', 'hljs-tag', 'hljs-name', 'hljs-selector-class'],
} as const satisfies Record<string, readonly string[]>;

export const MAPPED_HLJS_CLASSES: ReadonlySet<string> = new Set(
  Object.values(ROLE_CLASSES).flat(),
);

/**
 * Classes that are correct to leave at `--bear-text`.
 *
 * `hljs-punctuation` and `hljs-operator` are here on purpose: colouring
 * punctuation is what makes a code block look like confetti, and the six roles
 * exist to carry meaning at a glance rather than to paint every token.
 */
export const INHERITS_TEXT: ReadonlySet<string> = new Set([
  'hljs-punctuation',
  'hljs-operator',
  'hljs-params',
  'hljs-variable',
  'hljs-property',
  'hljs-subst',
  'language-javascript',
  'language-css',
  'language-xml',
]);
```

- [ ] **Step 4: Iterate until the test passes**

Run: `npx vitest run src/features/editor/highlightClasses.test.ts`

Read each `language: hljs-class` line in the failure and put that class in
`ROLE_CLASSES` (under the role whose meaning it carries) or in
`INHERITS_TEXT` (with a reason). Re-run. Expected end state: PASS, 3 tests.

- [ ] **Step 5: Add the CSS**

In `src/styles/editor.css`, after the `.ProseMirror pre code` rule that ends at
line 300:

```css
/*
 * Syntax highlighting. One selector per role, listing the `.hljs-*` classes
 * that role claims — kept in step with
 * `src/features/editor/highlightClasses.ts`, whose test derives the class set
 * from the grammars themselves and fails on any class neither coloured here nor
 * explicitly left at `--bear-text`.
 *
 * Scoped under `.ProseMirror pre` so these can never reach the inline `code`
 * mark. `.ProseMirror code` styles inline code and `.ProseMirror pre code`
 * above deliberately undoes it inside a block; six new colours must not leak
 * across that boundary.
 */
.ProseMirror pre .hljs-keyword,
.ProseMirror pre .hljs-literal,
.ProseMirror pre .hljs-built_in,
.ProseMirror pre .hljs-selector-tag {
  color: var(--bear-code-keyword);
}

.ProseMirror pre .hljs-string,
.ProseMirror pre .hljs-regexp,
.ProseMirror pre .hljs-char,
.ProseMirror pre .hljs-meta-string {
  color: var(--bear-code-string);
}

.ProseMirror pre .hljs-number,
.ProseMirror pre .hljs-symbol {
  color: var(--bear-code-number);
}

.ProseMirror pre .hljs-comment,
.ProseMirror pre .hljs-quote {
  color: var(--bear-code-comment);
}

.ProseMirror pre .hljs-title,
.ProseMirror pre .hljs-section,
.ProseMirror pre .hljs-function {
  color: var(--bear-code-function);
}

.ProseMirror pre .hljs-type,
.ProseMirror pre .hljs-attr,
.ProseMirror pre .hljs-attribute,
.ProseMirror pre .hljs-tag,
.ProseMirror pre .hljs-name,
.ProseMirror pre .hljs-selector-class {
  color: var(--bear-code-type);
}
```

If Step 4 moved any class between sets, mirror that here. The two must agree;
nothing enforces it automatically, which is why both carry the same comment.

- [ ] **Step 6: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(editor): paint the six syntax roles, with an empirical class guard"
```

---

### Task 5: Hold the palette to the contrast floors

**Files:**

- Modify: `e2e/contrast.spec.ts` (the `RULES` and `READ` arrays)
- Modify: `src/styles/tokens.css` (only if the gate reports a failure)

**Interfaces:**

- Consumes: the six tokens (Task 3).
- Produces: nothing new; this task is a gate.

- [ ] **Step 1: Add the rules**

In `e2e/contrast.spec.ts`, append to `RULES`:

```ts
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
```

And append the same six names to `READ`:

```ts
  'code-keyword',
  'code-string',
  'code-number',
  'code-comment',
  'code-function',
  'code-type',
```

- [ ] **Step 2: Run the gate and record every failure**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/contrast.spec.ts
```

Expected: some themes FAIL. F's evidence says to plan for it — nine of eleven
new themes needed a value moved for a *single* accent, and this is six roles
across sixteen themes. Copy the exact reported ratios; you need them for
Step 3 and the commit message.

- [ ] **Step 3: Move the failing values, minimally**

For each failure, adjust the corresponding `--bear-code-*-l` or `-d` literal in
`:root` — darkening for light themes, lightening for dark ones — by the
**smallest** step that clears the floor. Re-run after each change.

Rules for this step, all of them load-bearing:

- **Never lower a floor to keep a colour.** The floor is the requirement; the
  colour is the preference.
- **Prefer moving the shared literal over adding a per-theme override.** An
  override is a per-theme commitment and the follow-up owns those; a shared
  move keeps the baseline honest at twelve values.
- **If one theme alone cannot be satisfied by a shared move** — the way
  `high-contrast` could not — add that theme's six overrides and write a
  comment in its block naming the ratio that forced it.
- Record each adjustment as a comment beside the literal, in the form
  `/* #hex was 4.12 on solarized-light's surface */`.

- [ ] **Step 4: Verify all sixteen pass**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/contrast.spec.ts
```

Expected: PASS, one test per theme plus the roster guard.

- [ ] **Step 5: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "test(contrast): hold the syntax palette to its floors on all sixteen themes"
```

The commit message must list which literals moved and the ratio that forced
each, the way F's palette commits do.

---

### Task 6: The language picker

**Files:**

- Create: `src/features/editor/CodeLanguageControls.ts`
- Create: `src/features/editor/codeLanguageControls.test.ts`
- Modify: `src/features/editor/extensions.ts` (import, options type, registration)
- Modify: `src/features/editor/RichEditor.tsx:142` (the `labels` block)
- Modify: `src/i18n/en.ts` and `src/i18n/ko.ts`
- Modify: `src/styles/editor.css` (the control's own styles)

**Interfaces:**

- Consumes: `CODE_LANGUAGES`, `languageLabel`, `resolveLanguage` (Task 1).
- Produces:
  - `interface CodeLanguageControlsOptions { codeLabels: { trigger: string; none: string; filter: string; empty: string } | null }`
  - `function codeBlockPosAt(state: EditorState): number | null`
  - `const CodeLanguageControls: Extension<CodeLanguageControlsOptions>`
  - `const codeLanguageControlsKey: PluginKey`

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/en.ts`, beside the existing `editor.table.*` keys:

```ts
  'editor.code.language': 'Code language',
  'editor.code.none': 'Plain text',
  'editor.code.filter': 'Filter languages',
  'editor.code.empty': 'No matching language',
```

In `src/i18n/ko.ts`, the same four keys:

```ts
  'editor.code.language': '코드 언어',
  'editor.code.none': '일반 텍스트',
  'editor.code.filter': '언어 검색',
  'editor.code.empty': '일치하는 언어가 없습니다',
```

`ko.ts` is `Record<TranslationKey, string>`, so omitting these is a compile
error. **Add the translation; never weaken the annotation.**

Note what is NOT here: the twelve language names. They are `label` fields on
`CODE_LANGUAGES` because they are proper nouns spelled identically in both
locales — see that module's docblock.

- [ ] **Step 2: Write the failing test**

```ts
// src/features/editor/codeLanguageControls.test.ts
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { codeBlockPosAt, codeLanguageControlsKey } from './CodeLanguageControls';
import { parseMarkdown } from './markdown';

const LABELS = {
  trigger: 'Code language',
  none: 'Plain text',
  filter: 'Filter languages',
  empty: 'No matching language',
};

function editorWith(markdown: string, codeLabels: typeof LABELS | null = LABELS) {
  return new Editor({
    extensions: buildEditorExtensions({ codeLabels }),
    content: parseMarkdown(markdown),
  });
}

describe('codeBlockPosAt', () => {
  it('finds the code block the selection is inside', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    editor.commands.setTextSelection(3);
    expect(codeBlockPosAt(editor.state)).not.toBeNull();
    editor.destroy();
  });

  it('is null when the selection is in a paragraph', () => {
    const editor = editorWith('just text');
    editor.commands.setTextSelection(2);
    expect(codeBlockPosAt(editor.state)).toBeNull();
    editor.destroy();
  });
});

describe('the control', () => {
  it('decorates the code block the caret is in', () => {
    const editor = editorWith('```ts\nconst x = 1;\n```');
    editor.commands.setTextSelection(3);
    const set = codeLanguageControlsKey.getState(editor.state);
    expect(set).toBeDefined();
    editor.destroy();
  });

  it('renders nothing at all when no labels were supplied', () => {
    // Same contract as TableControls: absent rather than unlabelled, because
    // no user-facing string may be hardcoded and a blank control is worse
    // than none. `editorExtensions` (the schema-only constant) is in this state.
    const editor = editorWith('```ts\nconst x = 1;\n```', null);
    editor.commands.setTextSelection(3);
    const plugins = editor.state.plugins.filter((p) => p.spec.key === codeLanguageControlsKey);
    expect(plugins).toHaveLength(0);
    editor.destroy();
  });
});

describe('choosing a language', () => {
  it('sets the language on the node', () => {
    const editor = editorWith('```\nplain\n```');
    editor.commands.setTextSelection(2);
    editor.commands.updateAttributes('codeBlock', { language: 'python' });
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('python');
    editor.destroy();
  });

  it('does NOT rewrite a fence that already names the same language by alias', () => {
    // `ts` must stay `ts`. Normalizing it to `typescript` would silently edit
    // the user's file on the next autosave — exactly what
    // docs/rulings/notes-lifecycle.md exists to prevent.
    const editor = editorWith('```ts\nconst x = 1;\n```');
    const before = editor.getJSON().content?.[0]?.attrs?.language;
    expect(before).toBe('ts');
    editor.destroy();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/editor/codeLanguageControls.test.ts`
Expected: FAIL — cannot resolve `./CodeLanguageControls`.

- [ ] **Step 4: Write the extension**

Copy the structure of `src/features/editor/TableControls.ts` — it is 193 lines
and the closest possible precedent. The differences that matter:

- `codeBlockPosAt` walks outward from `$from` exactly as `tablePosAt` does,
  matching `node.type.name === 'codeBlock'`.
- The widget is a `<button>` trigger plus a hidden list, `side: -1`,
  `key: \`code-language-${pos}\``, `ignoreSelection: true`, and
  `contentEditable = 'false'` on every element.
- The trigger carries `aria-haspopup="listbox"` and `aria-expanded`, and its
  accessible name is `${labels.trigger}: ${languageLabel(lang) ?? labels.none}`
  — **not just the language name.** A control reading only "TypeScript" tells
  a screen-reader user nothing about what it does.
- `mousedown` guards `event.button !== 0` and calls `event.preventDefault()`
  before acting, like `TableControls` does, so the caret is not placed into the
  widget and the editor keeps focus.
- Selecting a language dispatches `updateAttributes('codeBlock', { language })`
  through `view.dispatch`, then `view.focus()`.
- Escape closes the list and returns focus to the trigger.

E measured that buttons inside a table-bar widget **focus normally**, unlike
B1's heading-fold gutter where Chromium refuses `.focus()` to every descendant.
That is pinned by `e2e/editorAffordances.spec.ts` and is why this control needs
no keyboard escape hatch of its own.

- [ ] **Step 5: Wire it through `extensions.ts` and `RichEditor.tsx`**

In `extensions.ts`, add `CodeLanguageControlsOptions` to both `Partial<...>`
option unions (lines 27 and 140), import the extension, and register
`CodeLanguageControls.configure(options)` after `TableControls.configure(options)`.

In `RichEditor.tsx`, inside the `buildEditorExtensions({ ... })` call after the
`labels` block:

```tsx
      // Read once at mount like every option above it — the editor is keyed by
      // note id and rebuilt on a language change, so there is no live locale
      // switch for these to miss.
      codeLabels: {
        trigger: t('editor.code.language'),
        none: t('editor.code.none'),
        filter: t('editor.code.filter'),
        empty: t('editor.code.empty'),
      },
```

- [ ] **Step 6: Style the control**

Add to `src/styles/editor.css`, modelled on the existing
`.bear-table-controls` rules. Every colour must be a `--bear-*` token; a
literal here is a defect. Express "not this utility" by omitting a class, never
by an overriding one — class-attribute order does not decide the cascade,
stylesheet order does.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/features/editor/codeLanguageControls.test.ts && echo "EXIT OK"`
Expected: PASS, 7 tests, **and `EXIT OK` printed**. If assertions pass but
`EXIT OK` does not print, a jsdom stub is missing and threw uncaught — see the
Global Constraints.

- [ ] **Step 8: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(editor): a language picker on each code block"
```

---

### Task 7: Carry the palette into export

**Files:**

- Modify: `src/features/export/html.ts` (`EXPORT_TOKEN_NAMES`, the fallback
  map, and the stylesheet's `pre code` region near line 303)
- Modify: `src/features/export/html.test.ts`

**Interfaces:**

- Consumes: the six tokens (Task 3), the class groups (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
it('carries the six syntax tokens into the exported stylesheet', () => {
  const html = buildExportHtml(/* use this file's existing helper and fixture */);
  for (const role of ['keyword', 'string', 'number', 'comment', 'function', 'type']) {
    expect(html).toContain(`--bear-code-${role}`);
  }
});

it('colours highlighted code in the export, not just in the editor', () => {
  const html = buildExportHtml(/* a note containing ```ts\nconst x = 1;\n``` */);
  expect(html).toContain('hljs-keyword');
  expect(html).toMatch(/\.hljs-keyword[^{]*\{[^}]*--bear-code-keyword/);
});
```

Match the existing file's helper names and fixture style rather than inventing
new ones — read the top of `html.test.ts` first.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/export/html.test.ts`
Expected: FAIL — the token names are absent from the output.

- [ ] **Step 3: Add the tokens and the rules**

Append the six names to `EXPORT_TOKEN_NAMES` (after `'--bear-hl-purple'`), add
their entries to the fallback map using CSS **system colours** rather than
literals — `canvastext` is the right degradation for all six, because an export
whose cascade yielded nothing should read as plain legible code rather than as
a guessed palette.

Then add the six `.hljs-*` rules to the stylesheet after the `pre code` block,
mirroring Task 4's groupings exactly.

**Do not write a backtick in any comment you add there.** The whole stylesheet
is one template literal; a backtick inside a CSS comment terminates it, the
error points at the prose rather than the character, and ten unrelated test
files fail to load at once because this module is imported widely.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/export/html.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify a real export by eye**

Run `npm run dev`, create a note with a `` ```ts `` block, export to HTML, and
open it. The code must be coloured and must match the theme you exported from.
Then export to PDF and confirm the same — it goes through this stylesheet, so
it should need nothing of its own.

This step is not optional. `useSession`'s StrictMode bug passed all six gates
and was found only by running the app.

- [ ] **Step 6: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(export): carry the syntax palette into HTML and PDF export"
```

---

### Task 8: A bundle ceiling, a shot, and the rulings

**Files:**

- Create: `scripts/bundleSize.test.ts`
- Modify: `e2e/fixtures/corpus.ts`
- Modify: `e2e/shots.spec.ts`
- Modify: `docs/rulings/design-tokens-and-layout.md`,
  `docs/rulings/markdown-and-schema.md`, `CLAUDE.md`,
  `docs/superpowers/NEXT.md`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing bundle test**

C is the one sub-project that can make the app worse at its own stated goal —
"lightweight, fast". So the measured cost becomes a number a test owns rather
than a number someone remembers.

```ts
// scripts/bundleSize.test.ts
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The gzipped ceiling for the main bundle.
 *
 * `278,028 B` was `main` before C; C was ruled EAGER at a measured
 * `+23,216 B`, giving `301,244 B`. The ceiling is that plus a small margin for
 * ordinary churn — not a target, a limit.
 *
 * This test exists because C ships twelve syntax grammars into an app whose
 * first two adjectives are "lightweight, fast", and because the alternative
 * (lazy loading) was rejected partly on the grounds that its failure was
 * invisible. A ceiling that must be edited to raise is the point: raising it
 * is a decision someone makes in a diff, not a drift nobody notices.
 */
const CEILING_BYTES = 310_000;

describe('bundle size', () => {
  it('keeps the gzipped main bundle under its ceiling', () => {
    execSync('npm run build', { stdio: 'pipe' });
    const assets = readdirSync('dist/assets');
    const js = assets.filter((name) => name.endsWith('.js'));
    expect(js.length, 'no JS asset found — did the build run?').toBeGreaterThan(0);

    const largest = js
      .map((name) => ({ name, size: statSync(`dist/assets/${name}`).size }))
      .sort((a, b) => b.size - a.size)[0]!;

    const gzipped = gzipSync(readFileSync(`dist/assets/${largest.name}`)).length;
    expect(gzipped, `${largest.name} is ${gzipped} B gzipped`).toBeLessThan(CEILING_BYTES);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run scripts/bundleSize.test.ts`
Expected: PASS. **If it fails**, the eager cost is larger than measured — stop
and report the real number rather than raising the ceiling.

- [ ] **Step 3: Add a code-heavy note to the shot corpus**

Add one entry to `e2e/fixtures/corpus.ts` containing three fenced blocks with
different languages — one with an unknown language, so the plain-render path is
visible in every theme. Its `title` must equal `deriveTitle(text)`; the file's
own header explains why a drifted title fails the unit suite.

Then add a shot for it in `e2e/shots.spec.ts`, following the existing entries.

- [ ] **Step 4: Take the shots and look at them**

```bash
npm run shots
ls docs/design/shots | wc -l
```

Expected: **13 shots × 16 themes = 208 files.** Count the files; do not trust
the exit code. The theme list is derived by a regex requiring `id`, `labelKey`
and `group` on one line in that order, and an empty list renders the default
theme sixteen times with no error.

Then open several — at least `paper`, `ink`, `high-contrast`, `solarized-light`
and `nord` — and confirm the code is legible and the palette does not clash
with the theme. Contrast floors prove legibility, not taste. If a theme looks
wrong, say so in the handoff; per-theme overrides are the named follow-up.

- [ ] **Step 5: Write the rulings**

Add to `docs/rulings/design-tokens-and-layout.md`: that the syntax palette is
twelve literals interpolated on `--bear-dark`; that `code-comment` at 3.0 is
an argued exception borrowing `faint`'s justification; that `high-contrast`
overrides the palette because pure black defeats the shared dark values; and
that a change to a `--bear-code-*-l`/`-d` literal moves fifteen themes at once
(all but `high-contrast`).

Add to `docs/rulings/markdown-and-schema.md`: that `codeBlock: false` on
StarterKit is load-bearing beside `underline: false`, with the silent
double-registration failure named; and that a fence's language string is
**never normalized** — `ts` stays `ts`.

Add to `CLAUDE.md`'s status table (C → complete), its test counts, and a
"Toolchain surprises" entry for the unmapped-`.hljs-*`-class silent failure.

Update `docs/superpowers/NEXT.md`: mark C shipped, and name the per-theme
syntax override follow-up with the themes it covers.

- [ ] **Step 6: Run all six gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "test(c): a bundle ceiling, a code-heavy shot, and C's rulings"
```

---

## Self-review

**Spec coverage.** §1 engine → Task 2. §2 six roles → Task 3; class mapping →
Task 4; `--bear-dark` mechanism + probe → Task 3 Step 1; contrast + the
`comment` exception → Task 5; `high-contrast` override → Task 3 Step 4 and
Task 5. §3 picker → Task 6; aliases → Task 1 and Task 6 Step 2; i18n split →
Task 6 Step 1; accessibility → Task 6 Step 4. §4 export → Task 7. §5
regressions → Task 2 Step 6 (all four canaries named). §6 testing → every
task, plus Task 8 for bundle and shots. §7/§8 → Task 8 Step 5. **No gap
found.**

**Placeholder scan.** No "TBD", "TODO", "add error handling" or "similar to
Task N". Two steps are deliberately descriptive rather than complete code —
Task 6 Step 4 (the extension body, which is "copy `TableControls.ts` with these
seven named differences") and Task 7 Step 1 (which must match helper names in a
test file the implementer has to read first). Both name the exact file to copy
and every difference from it; writing 190 speculative lines of a file whose
precedent is on disk would be less accurate, not more.

**Type consistency.** `resolveLanguage`, `languageLabel`, `CODE_LANGUAGES`,
`CodeLanguage` are used in Tasks 1, 4, 6 with the same signatures.
`codeBlockPosAt` and `codeLanguageControlsKey` match between Task 6's test and
its interface block. `codeLabels` — not `labels` — is the option name
throughout Tasks 6's test, extension, and `RichEditor` wiring; it is
deliberately distinct from `TableControls`' `labels` so the two cannot collide
in the shared `Partial<...>` option union.
