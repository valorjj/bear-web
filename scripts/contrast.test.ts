import { describe, expect, it } from 'vitest';

import { composite, contrastRatio, parseColour } from './contrast.ts';

describe('parseColour', () => {
  it('reads six-digit hex', () => {
    expect(parseColour('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('reads three-digit hex', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('reads the space-separated rgb() form the tokens are written in', () => {
    expect(parseColour('rgb(28 27 25 / 0.05)')).toEqual({ r: 28, g: 27, b: 25, a: 0.05 });
  });

  it('reads the comma form a browser returns from getComputedStyle', () => {
    expect(parseColour('rgba(28, 27, 25, 0.05)')).toEqual({ r: 28, g: 27, b: 25, a: 0.05 });
  });

  it('reads an opaque rgb() with no alpha at all', () => {
    expect(parseColour('rgb(18, 18, 17)')).toEqual({ r: 18, g: 18, b: 17, a: 1 });
  });

  /*
   * `color(srgb …)` is what every `color-mix()`-derived token computes to,
   * and this parser was silently blind to it before F.
   *
   * The blindness mattered more than a normal parser bug because of how the
   * harness consumes the result: `e2e/contrast.spec.ts` collects a failure
   * when `ratio < min`, and `NaN < min` is **false**. An unparseable colour
   * therefore did not throw and did not fail — it passed. The one harness
   * that exists to catch an unreadable theme would have reported every theme
   * green.
   */
  it('reads color(srgb …), whose components are 0–1 rather than 0–255', () => {
    const parsed = parseColour('color(srgb 0.356863 0.290196 0.839216)');

    expect(parsed.r).toBeCloseTo(91, 0);
    expect(parsed.g).toBeCloseTo(74, 0);
    expect(parsed.b).toBeCloseTo(214, 0);
    expect(parsed.a).toBe(1);
  });

  it('reads color(srgb …) with a slash alpha', () => {
    expect(parseColour('color(srgb 0 0 0 / 0.4)').a).toBeCloseTo(0.4, 5);
  });

  /**
   * `oklab(…)` — what `color-mix(in oklab, …)` computes to when its mixing
   * percentage is a `calc()` rather than a literal, discovered while building
   * Task 3's syntax palette: `--bear-muted`'s longstanding `color-mix(in
   * oklab, …)` uses a literal percentage and folds to `rgb(…)` well before it
   * reaches this function, so this format was unexercised until now. Known
   * conversion: `oklab(1 0 0)` is white, `oklab(0 0 0)` is black.
   */
  it('reads oklab(L a b), the format a calc()-percentage color-mix(in oklab, …) resolves to', () => {
    expect(parseColour('oklab(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('oklab(0 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('reads oklab(…) with a slash alpha', () => {
    expect(parseColour('oklab(1 0 0 / 0.4)').a).toBeCloseTo(0.4, 5);
  });

  /**
   * The guard that gives the two cases above their teeth.
   *
   * A per-format assertion only covers the formats someone thought to list.
   * This states the property the harness actually depends on — no input the
   * cascade can hand it may produce a NaN channel — so a future colour
   * function that slips through fails here instead of passing downstream.
   */
  it('never yields NaN for any format the cascade can hand it', () => {
    for (const css of [
      '#fff',
      '#ffffff',
      '#ffffff80',
      'rgb(255 255 255)',
      'rgb(255 255 255 / 0.5)',
      'rgba(255, 255, 255, 0.5)',
      'color(srgb 1 1 1)',
      'color(srgb 1 1 1 / 0.5)',
      'color(srgb 0.356863 0.290196 0.839216 / 0.12)',
      'oklab(0.523614 0.18045 -0.109351)',
      'oklab(0.742742 0.0885881 -0.101648 / 0.5)',
    ]) {
      const { r, g, b, a } = parseColour(css);
      expect(Number.isNaN(r + g + b + a), `${css} produced a NaN channel`).toBe(false);
    }
  });

  /**
   * Refuses rather than guesses. `color(display-p3 …)` has an identical shape
   * and wider primaries, so reading its components as sRGB would return a
   * plausible but wrong colour — and a wrong colour here is a wrong contrast
   * verdict, which is worse than a crash. Nothing emits p3 today; this exists
   * so that if anything ever does, it fails loudly.
   */
  it('throws on a colour space it cannot honestly interpret', () => {
    expect(() => parseColour('color(display-p3 1 0 0)')).toThrow(/display-p3/);
  });
});

describe('contrastRatio', () => {
  // End to end through the function the harness actually calls, in the new
  // format: a ratio, not just a parse.
  it('scores two color(srgb …) values, not just rgb() ones', () => {
    const ratio = contrastRatio(parseColour('color(srgb 1 1 1)'), parseColour('color(srgb 0 0 0)'));

    expect(ratio).toBeCloseTo(21, 1);
  });

  // Published values. Black on white is exactly 21:1 by definition; the
  // mid-grey case is the one that catches a linearisation mistake, which a
  // black/white-only test cannot see.
  it('scores black on white at 21:1', () => {
    expect(contrastRatio(parseColour('#000'), parseColour('#fff'))).toBeCloseTo(21, 2);
  });

  it('scores a colour against itself at 1:1', () => {
    expect(contrastRatio(parseColour('#777'), parseColour('#777'))).toBeCloseTo(1, 5);
  });

  it('linearises rather than averaging channels', () => {
    expect(contrastRatio(parseColour('#808080'), parseColour('#ffffff'))).toBeCloseTo(3.95, 1);
  });

  it('is symmetric', () => {
    const a = parseColour('#123456');
    const b = parseColour('#abcdef');
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe('composite', () => {
  it('returns the ground when the overlay is fully transparent', () => {
    const ground = parseColour('#ffffff');
    expect(composite(parseColour('rgb(0 0 0 / 0)'), ground)).toEqual(ground);
  });

  it('returns the overlay when it is opaque', () => {
    expect(composite(parseColour('#000000'), parseColour('#ffffff'))).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it('blends by alpha', () => {
    expect(composite(parseColour('rgb(0 0 0 / 0.5)'), parseColour('#ffffff'))).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });
});

describe('the recorded Paper and Ink ratios', () => {
  // These are the two numbers M7.5 measured BY HAND and recorded in
  // docs/design/DESIGN-bear-web.md. They are the harness's calibration: if the
  // maths here cannot reproduce a ratio a human already checked, its verdicts
  // on themes nobody has measured are worth nothing.
  it("reproduces Paper's faint-on-sidebar at 3.21:1", () => {
    expect(contrastRatio(parseColour('#88857d'), parseColour('#f1efec'))).toBeCloseTo(3.21, 1);
  });

  it("reproduces Ink's faint-on-sidebar at 3.40:1", () => {
    expect(contrastRatio(parseColour('#7b766e'), parseColour('#262523'))).toBeCloseTo(3.4, 1);
  });

  // The value M7.5 rejected. Pinned so the threshold this project chose stays
  // legible: 2.51 failed, 3.21 passed, and the bar is 3.0.
  it('reproduces the rejected 2.51:1 that motivated darkening faint', () => {
    expect(contrastRatio(parseColour('#9c988f'), parseColour('#f1efec'))).toBeCloseTo(2.51, 1);
  });
});
