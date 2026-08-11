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
