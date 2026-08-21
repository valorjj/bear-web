import { createHash, randomBytes } from 'node:crypto';

/** Opaque anti-forgery value tying a callback to the browser that started it. */
export function createState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A PKCE code verifier. 32 random bytes is 43 base64url characters, the
 * minimum RFC 7636 allows and enough entropy that guessing is not the attack.
 */
export function createVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 challenge: base64url of SHA-256 of the verifier, unpadded. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
