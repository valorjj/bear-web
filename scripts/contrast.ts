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
 * Parses a component token, honouring the two CSS Color 4 spellings that are
 * NOT plain numbers: a `%` suffix (0%-100% maps to 0-1, or to 0-255 when
 * `scale255` is set) and the `none` keyword, which means "this channel was
 * not specified" and is treated as 0 — the same substitution the spec uses
 * when a `none` channel reaches an operation that needs a real number.
 */
function parseComponent(token: string, scale255: boolean): number {
  if (token === 'none') {
    return 0;
  }
  if (token.endsWith('%')) {
    const pct = Number(token.slice(0, -1)) / 100;
    return scale255 ? pct * 255 : pct;
  }
  return Number(token);
}

/**
 * Accepts hex, both `rgb()` spellings (the space-slash form the tokens are
 * authored in, and the comma form `getComputedStyle` returns), `color(srgb
 * …)` and `oklab(…)` — the two functional notations `color-mix()` is known to
 * compute to in this codebase — and throws, naming the notation, on anything
 * else.
 *
 * The harness sees both authored values (reading the stylesheet) and resolved
 * values (reading the browser), so a parser handling only one spelling would
 * pass its own tests and fail on real input.
 *
 * **Why this throws rather than best-effort parsing an unknown notation.**
 * `color(srgb …)` and `oklab(…)` both reached this function unannounced —
 * once each, in F and in Task 3 — because color-mix() had shipped a spelling
 * this parser did not expect. Both times, the previous version of this
 * function fell through to a fallback that stripped an `rgb(` prefix that
 * was not there, `Number()`-ed the remaining text, and returned NaN channels.
 * `e2e/contrast.spec.ts` compares `ratio < min`, which is FALSE for NaN, so
 * an unreadable colour did not fail — it silently passed, and nine themes
 * shipped below AA before anyone noticed. `oklch()` is the obvious next
 * color-mix() interpolation space to be authored, `lab()` and `lch()` are
 * one keystroke away, and `hsl()`/`hwb()` are valid CSS this function has
 * never claimed to understand. Rather than add a fourth silent-blind-spot
 * branch, any notation this function has not been explicitly taught throws,
 * naming itself, so the next new format fails loudly INSTEAD of quietly
 * turning into a false pass — belt and braces with the finite-ratio check in
 * `e2e/contrast.spec.ts`, which closes the same class of bug independently
 * of whether this function is ever bypassed.
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

  const notation = text.match(/^([a-zA-Z-]+)\(/)?.[1]?.toLowerCase();
  if (notation === undefined) {
    throw new Error(`parseColour: unrecognised colour value ${JSON.stringify(text)}`);
  }

  if (notation === 'rgb' || notation === 'rgba') {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const tokens = inner.split(/[\s,/]+/).filter(Boolean);
    const [r = '0', g = '0', b = '0', a] = tokens;
    return {
      r: parseComponent(r, true),
      g: parseComponent(g, true),
      b: parseComponent(b, true),
      a: a === undefined ? 1 : parseComponent(a, false),
    };
  }

  /*
   * `color(srgb r g b / a)` — what every `color-mix()`-derived token computes
   * to when Chromium can fold the mix to sRGB. Its components are 0–1
   * floats, unlike `rgb()`'s 0–255, so they are scaled here.
   *
   * Any other colour space throws. `color(display-p3 …)` has an identical
   * shape and wider primaries, so reading its components as sRGB would yield
   * a plausible but wrong colour — and a wrong colour here is a wrong
   * contrast verdict, which is worse than a crash.
   */
  if (notation === 'color') {
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
   * this branch was unexercised until Task 3.
   *
   * `L` may be a bare 0–1 number OR a `%` (0%–100%, mapping to 0–1) — both
   * are valid CSS and Chromium is not guaranteed to always emit the same
   * one. Any of `L`, `a`, `b`, or the alpha may also be the `none` keyword,
   * meaning "not specified"; `parseComponent` maps that to 0. `a` and `b`
   * are otherwise signed and unbounded. The conversion is the CSS Color 4
   * matrix, oklab -> linear sRGB -> gamma-encoded sRGB, clamped to the sRGB
   * gamut — out-of-gamut components are physically possible in oklab and
   * must not be left as out-of-range or negative channel values.
   */
  if (notation === 'oklab') {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const tokens = inner.split(/[\s/]+/).filter(Boolean);
    const [lTok = '0', aTok = '0', bTok = '0', alphaTok] = tokens;
    const l = parseComponent(lTok, false);
    const a = parseComponent(aTok, false);
    const b = parseComponent(bTok, false);
    const alpha = alphaTok === undefined ? 1 : parseComponent(alphaTok, false);

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
      return encoded * 255;
    };

    return {
      r: toSrgb(linear.r),
      g: toSrgb(linear.g),
      b: toSrgb(linear.b),
      a: alpha,
    };
  }

  throw new Error(
    `parseColour: unsupported colour notation "${notation}()" in ${JSON.stringify(text)}`,
  );
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
