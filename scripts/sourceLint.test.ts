import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('lets only known files suppress the outline, each with a replacement', () => {
    const suppressors = walk('src', ['.tsx'])
      .filter((path) => !/\.test\.tsx$/.test(path))
      .filter((path) => /outline-none/.test(readFileSync(path, 'utf8')));

    expect(suppressors.sort()).toEqual(Object.keys(OUTLINE_SUPPRESSORS).sort());

    for (const [path, marker] of Object.entries(OUTLINE_SUPPRESSORS)) {
      expect(
        readFileSync(path, 'utf8'),
        `${path} suppresses the outline without documenting its replacement`,
      ).toContain(marker);
    }
  });
});
