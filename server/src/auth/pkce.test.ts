import { describe, expect, it } from 'vitest';

import { challengeOf, createState, createVerifier } from './pkce.ts';

describe('pkce', () => {
  it('generates a distinct state every time', () => {
    expect(createState()).not.toBe(createState());
  });

  it('generates a verifier inside RFC 7636 length limits', () => {
    const verifier = createVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('derives an S256 challenge that is not the verifier', () => {
    const verifier = createVerifier();
    const challenge = challengeOf(verifier);

    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });

  it('is deterministic for a given verifier', () => {
    // Known vector from RFC 7636 appendix B.
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
