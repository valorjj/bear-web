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

  const SANS_CSS =
    require.resolve('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css');
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
