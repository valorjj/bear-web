export const SESSION_COOKIE = 'mf_session';
export const TX_COOKIE = 'mf_oauth_tx';

/** Ten minutes: long enough for a slow consent screen, short enough to be forgettable. */
const TX_MAX_AGE = 600;

function serialise(name: string, value: string, maxAge: number, secure: boolean): string {
  // No `Domain` attribute anywhere in this file. Host-only scoping is what
  // keeps the cookie off lunch-api.markflowing.com and docs-api.markflowing.com.
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return serialise(SESSION_COOKIE, token, maxAgeSeconds, secure);
}

export function clearedSessionCookie(secure: boolean): string {
  return serialise(SESSION_COOKIE, '', 0, secure);
}

export function txCookie(value: string, secure: boolean): string {
  return serialise(TX_COOKIE, value, TX_MAX_AGE, secure);
}

export function clearedTxCookie(secure: boolean): string {
  return serialise(TX_COOKIE, '', 0, secure);
}

/**
 * Reads one cookie from a `Cookie` header.
 *
 * The name is matched against the whole segment, not with `includes`: a
 * `x_mf_session` cookie must not satisfy a read of `mf_session`.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}
