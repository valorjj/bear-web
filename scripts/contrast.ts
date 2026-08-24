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

  /*
   * `color(srgb r g b / a)` — what every `color-mix()`-derived token computes
   * to, and the format this function was silently blind to until F.
   *
   * Its components are 0–1 floats, unlike `rgb()`'s 0–255, so they are scaled
   * here. Without this branch the fallback below strips an `rgb(` prefix that
   * is not present, `Number()`s the string "color(srgb", and returns NaN
   * channels — and `e2e/contrast.spec.ts` collects a failure on
   * `ratio < min`, which is FALSE for NaN. An unreadable theme would have
   * passed rather than thrown.
   *
   * Any other colour space throws. `color(display-p3 …)` has an identical
   * shape and wider primaries, so reading its components as sRGB would yield
   * a plausible but wrong colour — and a wrong colour here is a wrong
   * contrast verdict, which is worse than a crash.
   */
  if (text.startsWith('color(')) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const [space, ...rest] = inner.split(/[\s,/]+/).filter(Boolean);
    if (space !== 'srgb') {
      throw new Error(`parseColour: unsupported colour space ${String(space)}`);
    }
    const [r = 0, g = 0, b = 0, a] = rest.map(Number);
    return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a };
  }

  /*
   * `oklab(L a b / alpha)` — what `color-mix(in oklab, …)` computes to when
   * its mixing percentage is a `calc()` rather than a literal, which is
   * exactly what Task 3's syntax palette uses (`calc((1 - var(--bear-dark))
   * * 100%)`). `--bear-muted`'s longstanding `color-mix(in oklab, …)` uses a
   * literal percentage and folds to `rgb(…)` before it ever reaches here, so
   * this branch was unexercised until now. Without it, the fallback below
   * strips an `rgb(` prefix that is not present and `Number()`s the string
   * `"oklab(0.52"`, yielding NaN channels — the exact silent-pass failure
   * mode the `color(srgb …)` branch above was added to close for a different
   * format.
   *
   * `L` is 0–1 here (this function never receives the `%` spelling); `a` and
   * `b` are signed and unbounded. The conversion is the CSS Color 4 matrix,
   * oklab -> linear sRGB -> gamma-encoded sRGB, clamped to the sRGB gamut —
   * out-of-gamut components are physically possible in oklab and must not be
   * left as out-of-range or negative channel values.
   */
  if (text.startsWith('oklab(')) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const [l = 0, a = 0, b = 0, alpha] = inner
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);

    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;

    const lCubed = l_ ** 3;
    const mCubed = m_ ** 3;
    const sCubed = s_ ** 3;

    const linear = {
      r: 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed,
      g: -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed,
      b: -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed,
    };

    const toSrgb = (value: number): number => {
      const clamped = Math.min(1, Math.max(0, value));
      const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255);
    };

    return {
      r: toSrgb(linear.r),
      g: toSrgb(linear.g),
      b: toSrgb(linear.b),
      a: alpha === undefined ? 1 : alpha,
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
