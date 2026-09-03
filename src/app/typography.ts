/**
 * The reader's typography preference: the model, its guard, and its
 * paint-time mirror. The direct analogue of `theme.ts`, and deliberately free
 * of React so the pre-paint path and the hook can share it.
 */
export interface Typography {
  /** px. */
  fontSize: number;
  /** Unitless, so it does not compound against the font size. */
  lineHeight: number;
  /** em. */
  lineWidth: number;
  /** em, ADDITIONAL to the block rhythm — Bear's own semantics. */
  paraSpacing: number;
  /** em. */
  paraIndent: number;
}

/** The durable record's key in the settings table. */
export const TYPOGRAPHY_KEY = 'typography';

/**
 * The paint-time cache's key. Namespaced for the same reason the theme's is:
 * `localStorage` is origin-wide and this app shares an origin with everything
 * else on github.io.
 */
export const TYPOGRAPHY_MIRROR_KEY = 'bear-web:typography';

export interface Bound {
  min: number;
  max: number;
  step: number;
}

/**
 * The ranges, chosen rather than measured, and each with a reason.
 *
 * `fontSize` floors at 13 because the app chrome is 14px and prose smaller
 * than its own furniture reads as broken; it stops at 22 because above that
 * the default measure exceeds a typical pane, `editor.css`'s clamp takes over,
 * and the control appears to stop working.
 *
 * `lineWidth` extends well past the default 40em ON PURPOSE. 40em was measured
 * off the real Bear during M8, and it is the number the "the content area
 * looks cramp" report is about: at 16px it is a 640px column inside an 840px
 * pane. `editor.css`'s `min(var(--bear-line-width), 100% - 3rem)` makes a wide
 * setting degrade rather than overflow on a narrow pane or a phone.
 *
 * These bounds are DUPLICATED in `index.html`'s pre-paint script, which cannot
 * import them — a module import is async and would defeat the point, exactly
 * as the theme roster is duplicated there. `scripts/sourceLint.test.ts`
 * asserts the two agree.
 */
export const BOUNDS: Record<keyof Typography, Bound> = {
  fontSize: { min: 13, max: 22, step: 1 },
  lineHeight: { min: 1.3, max: 2, step: 0.05 },
  lineWidth: { min: 30, max: 70, step: 2 },
  paraSpacing: { min: 0, max: 1.5, step: 0.25 },
  paraIndent: { min: 0, max: 3, step: 0.5 },
};

/**
 * Every default is the value `tokens.css` already ships, so a fresh install
 * renders exactly as it did before Q — which is what lets `measure:check` stay
 * a regression test rather than needing a new baseline.
 */
export const DEFAULTS: Typography = {
  fontSize: 16,
  lineHeight: 1.6,
  lineWidth: 40,
  paraSpacing: 0,
  paraIndent: 0,
};

const FIELDS = Object.keys(BOUNDS) as (keyof Typography)[];

/**
 * Runs on every read, for the reason `useSetting`'s docblock gives: a row
 * written by a future version, or edited by hand in devtools, must fall back
 * rather than reach a consumer that cannot handle it. Here the consumer is
 * CSS, where the failure is silent — `--bear-font-size: NaNpx` renders an
 * unreadable note and logs nothing.
 */
export function isTypography(value: unknown): value is Typography {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return FIELDS.every((field) => {
    const found = row[field];
    /*
     * The bound comparison is what rejects NaN and both infinities, and it
     * does so without a `Number.isFinite` call: every comparison against NaN
     * is false, `Infinity <= max` is false, and `-Infinity >= min` is false.
     * An explicit finiteness check was written here first and a fault
     * injection proved it dead — removing it failed nothing — so it is
     * recorded rather than carried. Anything that makes a bound optional
     * brings the hazard back.
     */
    return typeof found === 'number' && found >= BOUNDS[field].min && found <= BOUNDS[field].max;
  });
}

/**
 * Clamps to the bound and snaps to the step.
 *
 * A range input hands back min + step*n computed in floating point, which
 * yields values like 1.6500000000000001 — noise in the readout, and noise in
 * a token value.
 */
export function snapField(field: keyof Typography, raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULTS[field];
  const { min, max, step } = BOUNDS[field];
  const clamped = Math.min(max, Math.max(min, raw));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Number(snapped.toFixed(2));
}

/** The five custom properties, each in the unit its consumer expects. */
export function typographyProperties(value: Typography): Record<string, string> {
  return {
    '--bear-font-size': `${value.fontSize}px`,
    '--bear-line-height': String(value.lineHeight),
    '--bear-line-width': `${value.lineWidth}em`,
    '--bear-para-spacing': `${value.paraSpacing}em`,
    '--bear-para-indent': `${value.paraIndent}em`,
  };
}

export function applyTypography(
  value: Typography,
  root: HTMLElement = document.documentElement,
): void {
  for (const [name, property] of Object.entries(typographyProperties(value))) {
    root.style.setProperty(name, property);
  }
}

export function readTypographyMirror(): Typography {
  try {
    const stored = localStorage.getItem(TYPOGRAPHY_MIRROR_KEY);
    if (stored === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(stored);
    return isTypography(parsed) ? parsed : DEFAULTS;
  } catch {
    // Private-mode Safari and some embedded webviews throw on access rather
    // than returning null, and `JSON.parse` throws on a corrupt entry. A
    // reading preference must never break boot.
    return DEFAULTS;
  }
}

export function writeTypographyMirror(value: Typography): void {
  try {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify(value));
  } catch {
    // Ignored: the settings table is the source of truth. Losing the mirror
    // costs a reflow on the next launch, not the preference.
  }
}
