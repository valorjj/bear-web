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
});

describe('contrastRatio', () => {
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
