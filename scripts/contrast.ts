/**
 * Contrast maths for the theme harness.
 *
 * This exists because `CLAUDE.md`'s standing rule was that no test could check
 * a contrast ratio: composing an alpha overlay against its ground needs a real
 * cascade, and jsdom has none, so Paper's and Ink's ratios were measured by
 * hand. Two palettes make that tenable; five do not, and a failed ratio is the
 * defect most likely to ship silently.
 *
 * Chromium resolves `var()` and hands back real values, so the compositing and
 * the ratio are ordinary arithmetic once the tokens are read. That arithmetic
 * lives here, in `scripts/` rather than `src/`, because `tsconfig.app.json`
 * deliberately omits Node types and this is tooling, not product code.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Accepts hex, and both `rgb()` spellings: the space-slash form the tokens are
 * authored in, and the comma form `getComputedStyle` returns. The harness sees
 * both — authored values when reading the stylesheet, resolved values when
 * reading the browser — so a parser handling only one would pass its own tests
 * and fail on real input.
 */
export function parseColour(css: string): Rgba {
  const text = css.trim();

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const wide = hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
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

  const [r = 0, g = 0, b = 0, a] = parts;
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

/** sRGB channel to linear light. The curve, not a gamma approximation. */
function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
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
