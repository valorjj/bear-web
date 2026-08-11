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
