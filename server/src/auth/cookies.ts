export const SESSION_COOKIE = 'mf_session';
export const TX_COOKIE = 'mf_oauth_tx';

/** Ten minutes: long enough for a slow consent screen, short enough to be forgettable. */
const TX_MAX_AGE = 600;

/**
 * The name actually sent on the wire.
 *
 * The `__Host-` prefix is browser-enforced: a cookie carrying it is rejected
 * outright unless it has `Secure`, `Path=/`, and no `Domain` attribute. That —
 * not the absence of a `Domain` attribute here, which only stops *this*
 * cookie from being sent to a sibling subdomain, and does nothing to stop a
 * sibling subdomain from setting `Domain=.markflowing.com` and shadowing or
 * injecting this cookie for the API — is what keeps a compromise of
 * `lunch-api.markflowing.com` or `docs-api.markflowing.com` from forging a
 * login transaction or a session here. `__Host-` requires `Secure`, which
 * `http://localhost` cannot use, so the prefix only applies when `secure` is
 * true; local dev keeps the bare name.
 */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}

function serialise(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return serialise(cookieName(SESSION_COOKIE, secure), token, maxAgeSeconds, secure);
}

export function clearedSessionCookie(secure: boolean): string {
  return serialise(cookieName(SESSION_COOKIE, secure), '', 0, secure);
}

export function txCookie(value: string, secure: boolean): string {
  return serialise(cookieName(TX_COOKIE, secure), value, TX_MAX_AGE, secure);
}

export function clearedTxCookie(secure: boolean): string {
  return serialise(cookieName(TX_COOKIE, secure), '', 0, secure);
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
