import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyTypography,
  BOUNDS,
  DEFAULTS,
  isTypography,
  readTypographyMirror,
  snapField,
  TYPOGRAPHY_MIRROR_KEY,
  typographyProperties,
  writeTypographyMirror,
} from './typography';

describe('DEFAULTS', () => {
  /*
   * The whole no-regression argument for Q rests on this: the defaults are
   * today's token values, so `measure:check` stays a regression test rather
   * than needing a new baseline. If someone "improves" a default here, that
   * gate fails and the reason will not be obvious from its diff — so it is
   * asserted where the change would be made.
   */
  it('are the values tokens.css already ships', () => {
    expect(DEFAULTS).toEqual({
      fontSize: 16,
      lineHeight: 1.6,
      lineWidth: 40,
      paraSpacing: 0,
      paraIndent: 0,
    });
  });

  it('are themselves valid', () => {
    expect(isTypography(DEFAULTS)).toBe(true);
  });
});

describe('isTypography', () => {
  it('rejects a non-object', () => {
    expect(isTypography(null)).toBe(false);
    expect(isTypography(undefined)).toBe(false);
    expect(isTypography(16)).toBe(false);
    expect(isTypography('16px')).toBe(false);
  });

  it('rejects a row missing a field', () => {
    const { paraIndent: _dropped, ...partial } = DEFAULTS;
    expect(isTypography(partial)).toBe(false);
  });

  it('rejects a non-numeric field', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: '16' })).toBe(false);
  });

  /*
   * NaN is the case that matters most: `--bear-font-size: NaNpx` renders an
   * unreadable note with no error anywhere — the same silent shape as
   * `parseColour`'s NaN and an unmapped `.hljs-*` class.
   *
   * It is caught by the BOUND comparison, not by a finiteness check, because
   * every comparison against NaN is false. An explicit `Number.isFinite` was
   * written into the guard first; deleting it failed nothing, so it went.
   * This test still earns its place — it pins the behaviour against a future
   * guard that compares differently — but it does not prove a finiteness
   * check exists, and it never did.
   */
  it('rejects NaN and Infinity', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: Number.NaN })).toBe(false);
    expect(isTypography({ ...DEFAULTS, lineHeight: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects a value outside its bound in either direction', () => {
    expect(isTypography({ ...DEFAULTS, fontSize: BOUNDS.fontSize.min - 1 })).toBe(false);
    expect(isTypography({ ...DEFAULTS, fontSize: BOUNDS.fontSize.max + 1 })).toBe(false);
    expect(isTypography({ ...DEFAULTS, lineWidth: 0 })).toBe(false);
  });

  it('accepts each bound exactly', () => {
    for (const field of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
      expect(isTypography({ ...DEFAULTS, [field]: BOUNDS[field].min })).toBe(true);
      expect(isTypography({ ...DEFAULTS, [field]: BOUNDS[field].max })).toBe(true);
    }
  });

  // A row written by a future version must degrade, not reach a consumer.
  it('accepts a row carrying an unknown extra field', () => {
    expect(isTypography({ ...DEFAULTS, headingRatio: 1.2 })).toBe(true);
  });
});

describe('snapField', () => {
  /*
   * A range input's value is a string the browser computed as min + step*n,
   * and float arithmetic there produces things like 1.6500000000000001. That
   * reaches CSS as a token value and reaches the readout as visible noise.
   */
  it('snaps to the step and kills float dust', () => {
    expect(snapField('lineHeight', 1.6500000000000001)).toBe(1.65);
    expect(snapField('paraSpacing', 0.7499999999)).toBe(0.75);
    expect(snapField('fontSize', 16.4)).toBe(16);
  });

  it('clamps to the bounds', () => {
    expect(snapField('fontSize', 99)).toBe(BOUNDS.fontSize.max);
    expect(snapField('fontSize', -5)).toBe(BOUNDS.fontSize.min);
  });

  it('returns the field default for a value that is not a number', () => {
    expect(snapField('fontSize', Number.NaN)).toBe(DEFAULTS.fontSize);
  });
});

describe('typographyProperties', () => {
  it('carries the unit each consumer expects', () => {
    expect(typographyProperties(DEFAULTS)).toEqual({
      '--bear-font-size': '16px',
      '--bear-line-height': '1.6',
      '--bear-line-width': '40em',
      '--bear-para-spacing': '0em',
      '--bear-para-indent': '0em',
    });
  });

  // `line-height` is the one that is unitless, and `1.6em` would compound
  // against the font size on every nested block.
  it('leaves line height unitless', () => {
    expect(typographyProperties(DEFAULTS)['--bear-line-height']).toBe('1.6');
  });
});

describe('applyTypography', () => {
  it('writes exactly the five properties, and no others', () => {
    const root = document.createElement('div');
    applyTypography({ ...DEFAULTS, fontSize: 20 }, root);
    expect(root.style.getPropertyValue('--bear-font-size')).toBe('20px');
    expect(root.style.length).toBe(5);
  });
});

describe('the mirror', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips', () => {
    const value = { ...DEFAULTS, fontSize: 19, lineWidth: 52 };
    writeTypographyMirror(value);
    expect(readTypographyMirror()).toEqual(value);
  });

  it('degrades to the defaults when absent', () => {
    expect(readTypographyMirror()).toEqual(DEFAULTS);
  });

  // A mirror edited by hand in devtools, or left by an older build.
  it('degrades to the defaults on unparseable or invalid content', () => {
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, 'not json');
    expect(readTypographyMirror()).toEqual(DEFAULTS);
    localStorage.setItem(TYPOGRAPHY_MIRROR_KEY, JSON.stringify({ fontSize: 999 }));
    expect(readTypographyMirror()).toEqual(DEFAULTS);
  });
});
