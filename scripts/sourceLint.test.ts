import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blab\(|\bcolor\(/;

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
      // Two shapes, because components here write multi-line template literals
      // for conditional classes: the colour often lands on a continuation line
      // with no `className` token on it. A purely positional predicate scored
      // that as safe — the exact place the comment above claims to cover.
      if (/-\[[^\]]*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|lab\(|color\()/.test(line))
        return true;
      return /className|style=|style:/.test(line);
    })
    .map(({ line, number }) => `${path}:${number}  ${line.trim()}`);
}

/**
 * Normalises an import specifier to a repo-relative path under `src/`, or null
 * for a package import.
 *
 * Both forms must be normalised, not just the alias. `src/ui`, `src/data` and
 * `src/lib` are flat siblings under `src/`, so `../data` from
 * `src/ui/EmptyState.tsx` reaches the data layer in a single hop — matching
 * only `@/` specifiers left that bypass wide open.
 */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('.'))
    return relative(process.cwd(), resolve(dirname(fromFile), specifier));
  return null;
}

/**
 * `--name: value` pairs inside the first `{ … }` following `selector`.
 *
 * `selector` is matched as raw TEXT, so **leading indentation is
 * significant** and is how two blocks with the same selector are told apart.
 * F introduced exactly that case: `:root:not([data-theme])` appears both at
 * the top level (the default light theme) and indented inside
 * `@media (prefers-color-scheme: dark)`. Passing the bare selector finds the
 * FIRST, which silently made the system-dark assertion compare a light theme
 * against a dark one. Callers must pass `'\n:root:not([data-theme])'` or
 * `'\n  :root:not([data-theme])'` to disambiguate.
 *
 * It also cannot read a grouped `a, b { … }` selector at all, which is why
 * this file forbids merging blocks.
 */
function blockTokens(css: string, selector: string): Map<string, string> {
  // Anchored on the block opening, so a selector NAMED IN PROSE inside a
  // comment is not mistaken for a second definition of it. The ambiguity
  // check below caught exactly that on its first run: a comment reading
  // "must stay identical to `[data-theme='indigo-light']` below" made the
  // selector look duplicated.
  const opening = `${selector} {`;
  const start = css.indexOf(opening);
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0);
  expect(
    css.indexOf(opening, start + 1),
    `selector is ambiguous, it appears more than once: ${selector}`,
  ).toBe(-1);

  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);

  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

describe('design lint', () => {
  const cssFiles = walk('src', ['.css']).filter((path) => path !== TOKENS);
  const codeFiles = walk('src', ['.tsx', '.ts']).filter((path) => !/\.test\.tsx?$/.test(path));
  const files = [...cssFiles, ...codeFiles];

  it('scans both stylesheets and components', () => {
    // Counted separately, deliberately. A single combined threshold is blind
    // to one half of the scan returning nothing: with ~57 component files,
    // zeroing the CSS walk still cleared a combined threshold of 20, so the
    // colour-literal assertion below would have gone vacuously green for
    // every stylesheet in the app while still reporting a pass.
    expect(cssFiles.length, 'no stylesheets found').toBeGreaterThan(0);
    expect(codeFiles.length, 'no components found').toBeGreaterThan(20);
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
      forbidden: ['src/app', 'src/data', 'src/features', 'src/i18n'],
      why: 'presentation primitives take strings and numbers as props',
    },
    {
      dir: 'src/lib',
      forbidden: ['src/app', 'src/data', 'src/features', 'src/i18n'],
      why: 'framework-level hooks carry no product knowledge',
    },
    {
      dir: 'src/data',
      forbidden: ['src/features'],
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
            .map((match) => resolveImport(path, match[1]!))
            .filter((target): target is string => target !== null)
            .filter((target) =>
              forbidden.some((root) => target === root || target.startsWith(`${root}/`)),
            )
            .map((target) => `${path} imports ${target}`);
        });

      expect(offenders).toEqual([]);
    });
  }

  it('imports lucide-react only through src/ui/Icon.tsx', () => {
    // Size, stroke and aria-hidden are decided in one place. A second importer
    // would compile and look fine, which is exactly why this is a test rather
    // than a comment — cf. `@tiptap/markdown`, whose single-importer rule is
    // convention enforced by nothing.
    const offenders = walk('src', ['.ts', '.tsx'])
      .filter((path) => path !== 'src/ui/Icon.tsx')
      .filter((path) => path !== 'src/ui/Icon.test.tsx')
      .filter((path) => /from ['"]lucide-react['"]/.test(readFileSync(path, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('scans a non-trivial number of files in each guarded directory', () => {
    // Guards the guard, again: a typo'd directory name would make every
    // boundary above vacuously true. Threshold is deliberately 1, not the
    // higher bar used elsewhere in this file: src/lib holds exactly one
    // source file plus its own test (2 total, and this walk() does not
    // filter test files), so a threshold above 1 fails on a directory that
    // is legitimately this small rather than on a typo. See
    // task-2-report.md for the brief's original threshold and why it was
    // lowered instead of the directory being padded with a fixture file.
    for (const { dir } of BOUNDARIES) {
      expect(walk(dir, ['.ts', '.tsx']).length, `${dir} looks empty`).toBeGreaterThan(1);
    }
  });
});

describe('theme tokens', () => {
  const css = readFileSync(TOKENS, 'utf8');

  const PALETTE = [
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
    'code-keyword',
    'code-string',
    'code-number',
    'code-comment',
    'code-function',
    'code-type',
  ];
  const SURFACE = [
    'radius-sm',
    'radius-md',
    'radius-lg',
    'shadow-popover',
    'shadow-dialog',
    'border-width',
  ];
  const REQUIRED = [...PALETTE, ...SURFACE];

  // Read from the roster rather than restated here: two lists that must agree
  // is the defect this whole describe block exists to prevent.
  const roster = readFileSync('src/styles/themes.ts', 'utf8');
  const ids = [...roster.matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1]!);

  // A floor, not a count: the roster grows a row at a time, each alongside the
  // CSS block it names, and the two-way agreement below is what actually
  // guards it. The floor exists only so a roster regex that silently matched
  // nothing cannot make every assertion here vacuously true.
  it('finds themes in the roster at all', () => {
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  /*
   * The eight colours a theme must choose for itself, plus the scheme scalar.
   * Everything else has a derived default in `:root` — see the "derived theme
   * defaults" section of `tokens.css`.
   */
  const BASE = ['bg', 'surface', 'sidebar', 'canvas', 'text', 'accent', 'danger', 'shadow'];

  /*
   * Split from a single "every theme defines all 26" assertion when F made
   * that impossible. The pair is strictly stronger than weakening the
   * original: a theme must still declare its own identity, AND every token a
   * component consumes must still resolve for every theme.
   */
  it('gives every theme in the roster a CSS block defining all 8 base tokens', () => {
    for (const id of ids) {
      const block = blockTokens(css, `[data-theme='${id}']`);
      for (const token of BASE) {
        expect(block.has(`--bear-${token}`), `--bear-${token} missing from ${id}`).toBe(true);
      }
      expect(block.has('--bear-dark'), `--bear-dark missing from ${id}`).toBe(true);
    }
  });

  /*
   * The other half of the pair above. A theme declares BASE and may omit
   * everything else, so everything else has to resolve from `:root` — a token
   * defined in neither place renders as nothing at all, with no error.
   *
   * BASE is excluded deliberately: those are per-theme by definition and
   * `:root` must NOT carry them. Putting the default palette in `:root` is
   * precisely the bug F had to fix — a literal there applies to every theme
   * that does not override it, which silently killed the derived defaults.
   */
  it('defines every non-base token in :root, so a theme may omit them', () => {
    const root = blockTokens(css, '\n:root');
    for (const token of REQUIRED) {
      if (BASE.includes(token)) {
        expect(root.has(`--bear-${token}`), `${token} must NOT be in :root`).toBe(false);
        continue;
      }
      expect(root.has(`--bear-${token}`), `--bear-${token} missing from :root`).toBe(true);
    }
  });

  it('has no CSS theme block that is absent from the roster', () => {
    const declared = [...css.matchAll(/:root\[data-theme='([a-z-]+)'\]/g)].map(
      (match) => match[1]!,
    );
    for (const id of new Set(declared)) {
      expect(ids, `${id} has a CSS block but no roster entry`).toContain(id);
    }
  });

  /*
   * The no-choice block and the default theme's own block must not drift
   * apart: a user on System and a user who explicitly picked the default must
   * see one app.
   *
   * The palette moved OUT of `:root` into `:root:not([data-theme])` during F,
   * and that was not tidying. A literal in `:root` beats the derived defaults
   * AND applies to every theme that does not override the same token, so a
   * new theme declaring only its eight base colours silently inherited the
   * default's `muted`, `faint`, `border` and `focus` — the entire derived
   * section was dead while every test passed. `:not([data-theme])` cannot
   * match a themed root, so the conflict disappears rather than being won.
   *
   * Compared over every token the two blocks declare, not just BASE: this
   * pair are both full palettes and both must stay complete.
   */
  it('keeps the no-choice block identical to the default theme block', () => {
    const fallback = blockTokens(css, '\n:root:not([data-theme])');
    const defaultId = roster.match(/DEFAULT_THEME_ID: ThemeId = '([a-z-]+)'/)![1]!;
    const explicit = blockTokens(css, `[data-theme='${defaultId}']`);
    for (const token of REQUIRED) {
      expect(fallback.get(`--bear-${token}`), `${token} drifted from ${defaultId}`).toBe(
        explicit.get(`--bear-${token}`),
      );
    }
  });

  // The M2-era hazard, generalised: a token right for someone who picked dark
  // and wrong for someone whose OS is dark. Nothing else in the suite sees it.
  it('keeps the system-dark block identical to its named theme', () => {
    // Indented: the media-query copy, not the top-level default block. See
    // `blockTokens`' docblock — the bare selector now matches both.
    const system = blockTokens(css, '\n  :root:not([data-theme])');
    const darkId = roster.match(/SYSTEM_DARK_ID: ThemeId = '([a-z-]+)'/)![1]!;
    const named = blockTokens(css, `[data-theme='${darkId}']`);
    expect([...system.keys()].sort()).toEqual([...named.keys()].sort());
    for (const [token, value] of named) {
      expect(system.get(token), `${token} differs between the dark blocks`).toBe(value);
    }
  });

  // The guard must reject ANY explicit theme, not only one named 'light'. With
  // named themes the old selector let every light theme lose to a dark OS.
  it('guards the system-dark block on the attribute, not on a theme name', () => {
    expect(css).toContain(':root:not([data-theme])');
    expect(css).not.toContain(":root:not([data-theme='light'])");
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

describe('focus', () => {
  it('defines one global focus-visible ring driven by the focus token', () => {
    const css = readFileSync('src/styles/index.css', 'utf8');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--bear-focus\)/);
  });

  /**
   * Files permitted to suppress the focus outline, each mapped to a string
   * that must appear in it proving it supplies its own indicator. A NEW
   * suppressor fails this test — adding one means editing this map, which is
   * reviewable.
   */
  const OUTLINE_SUPPRESSORS: Record<string, string> = {
    // The accent hairline drawn on `group-focus-visible` is the indicator
    // here. The default ring would frame an 8px invisible hit area instead.
    'src/ui/Resizer.tsx': 'group-focus-visible:',
    // The text caret is the focus indicator for a contenteditable surface; no
    // editor rings its whole writing area. Recorded so the suppression is a
    // decision rather than the accident it was until M5.5.
    'src/features/editor/RichEditor.tsx': 'caret is the focus indicator',
  };

  /**
   * Whether `path` (a `.css` file) contains a rule whose selector carries
   * `:focus` or `:focus-visible` and whose body sets `outline: none` /
   * `outline: 0`.
   *
   * Matches innermost `selector { body }` blocks only — a `[^{}]+\{[^{}]*\}`
   * pattern cannot span a brace, so a rule nested inside `@media { … }`
   * still matches on its own inner block while the `@media` wrapper itself
   * never does. That is sufficient for this codebase's CSS, which nests at
   * most one level deep (a media/supports query wrapping plain rules).
   *
   * Deliberately does NOT match `src/styles/index.css`'s global
   * `:focus-visible { outline: 2px solid var(--bear-focus); … }` — that rule
   * DEFINES the ring, and its outline value is a colour, not `none`/`0`.
   */
  function cssSuppressesFocusOutline(path: string): boolean {
    const css = readFileSync(path, 'utf8');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = match;
      if (!/:focus(-visible)?\b/.test(selector!)) continue;
      if (/\boutline\s*:\s*(none|0)\b/.test(body!)) return true;
    }
    return false;
  }

  it('lets only known files suppress the outline, each with a replacement', () => {
    const tsxSuppressors = walk('src', ['.tsx'])
      .filter((path) => !/\.test\.tsx$/.test(path))
      // A bare `outline-none` is dead: the unlayered global `:focus-visible`
      // rule in index.css beats it regardless of specificity (Task 3b, M7.5).
      // Only the `focus-visible:` variant — matched at (0,2,0) specificity —
      // actually wins the cascade and suppresses anything. Matching the bare
      // form here would let a file revert to the dead form and still satisfy
      // this test, which is exactly what shipped, undetected, until Task 3b.
      .filter((path) => /focus-visible:outline-none/.test(readFileSync(path, 'utf8')));

    // CSS files can suppress the outline directly with `outline: none` under
    // a `:focus`/`:focus-visible` selector — no Tailwind variant involved, so
    // the `.tsx`-only scan above cannot see it. This shipped once already
    // (Task 6, `.bear-code-language-list:focus { outline: none }`) with a
    // fully green suite; `tokens.css` is excluded the way the colour-literal
    // guard excludes it, since it carries no selectors at all.
    const cssSuppressors = walk('src', ['.css'])
      .filter((path) => path !== TOKENS)
      .filter(cssSuppressesFocusOutline);

    const suppressors = [...tsxSuppressors, ...cssSuppressors];

    expect(suppressors.sort()).toEqual(Object.keys(OUTLINE_SUPPRESSORS).sort());

    for (const [path, marker] of Object.entries(OUTLINE_SUPPRESSORS)) {
      expect(
        readFileSync(path, 'utf8'),
        `${path} suppresses the outline without documenting its replacement`,
      ).toContain(marker);
    }
  });
});

describe('the pre-paint theme script', () => {
  const html = readFileSync('index.html', 'utf8');
  const roster = readFileSync('src/styles/themes.ts', 'utf8');
  const ids = [...roster.matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1]!);

  // The script cannot import the roster — a module import is async, and the
  // whole point is to run before first paint. So the list is duplicated, and
  // this is what stops it drifting: a theme added to the roster but missing
  // here silently loses its no-flash behaviour, and nothing else in the suite
  // can see that.
  it('lists exactly the roster ids', () => {
    const listed = html.match(/var known = \[([^\]]+)\]/)![1]!;
    for (const id of ids) {
      expect(listed, `${id} missing from the pre-paint script`).toContain(`'${id}'`);
    }
    // Parsed as quoted ids rather than `split(',')`. Prettier rewraps the
    // array onto one line per entry once it grows past the print width and
    // adds a trailing comma, which made a naive split report one phantom
    // extra element. The count assertion is the half that catches a STALE id
    // left behind after a rename, so it has to survive reformatting.
    // Sorted: `known` is a membership set, while the roster is in picker
    // order (light group, then dark), so their orders legitimately differ.
    expect([...listed.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!).sort()).toEqual(
      [...ids].sort(),
    );
  });

  it('reads the same storage key the app writes', () => {
    const key = readFileSync('src/app/theme.ts', 'utf8').match(/MIRROR_KEY = '([^']+)'/)![1]!;
    expect(html).toContain(`localStorage.getItem('${key}')`);
  });

  // It has to beat the module that renders the app, or it is decorative.
  it('runs before the app script', () => {
    expect(html.indexOf('bear-web:theme')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });
});

describe('the spacing scale', () => {
  /*
   * Tailwind's grid permits every step, which is not a scale. The shipped code
   * used ten of them with no rule — `px-1.5`, `p-5`, `pl-7` beside `px-2` and
   * `p-4` — and that drift is what reads as misalignment.
   *
   * This replaces the "why there are no spacing tokens" ruling in
   * DESIGN-bear-web.md. The fix is not a second token system competing with
   * Tailwind: it is a permitted subset of Tailwind's own scale, enforced the
   * same way a stray hex literal already is.
   *
   * Permitted: 2 4 8 12 16 24 32 48 px.
   */
  const PERMITTED = new Set(['0', '0.5', '1', '2', '3', '4', '6', '8', '12', 'px', 'auto', 'full']);

  const UTILITY =
    /(?:^|[\s'"`{])(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(\[?[\w.%[\]()-]+)/g;

  /**
   * Off-scale values with a stated reason, in the shape of the focus-outline
   * allowlist. An arbitrary value is an escape hatch, not a forbidden thing —
   * but each one is named here, so it is a decision rather than a drift.
   */
  const ALLOWED: Record<string, string> = {
    'src/features/editor/RichEditor.tsx':
      'pt-12/pb-24 reserve the space the floating toolbars overlay, which is a computed reach rather than a rhythm; e2e/appearance.spec.ts asserts the reserve covers each pill',
  };

  it('scans a non-trivial number of components', () => {
    // Guards the guard: a walk returning nothing would make the scan below
    // vacuously green.
    expect(walk('src', ['.tsx']).length).toBeGreaterThan(20);
  });

  it('uses only permitted spacing steps', () => {
    const offenders: string[] = [];

    for (const path of walk('src', ['.tsx'])) {
      if (path in ALLOWED) continue;
      if (/\.test\.tsx?$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(UTILITY)) {
        const step = match[1]!;
        if (!PERMITTED.has(step)) offenders.push(`${path}  ${match[0]!.trim()}`);
      }
    }

    expect(offenders, `off-scale spacing:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps every allowlisted file real, with its reason', () => {
    // An allowlist entry for a file that no longer exists is a licence nobody
    // is using and nobody will notice has gone stale.
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(existsSync(path), `${path} is allowlisted but absent`).toBe(true);
      expect(reason.length, `${path} needs a stated reason`).toBeGreaterThan(20);
    }
  });
});
