import type { AppDeps } from '../app.ts';
import { findSession } from '../repositories/sessions.ts';
import { cookieName, readCookie, SESSION_COOKIE } from './cookies.ts';

/**
 * Resolves a request's cookie header to a user id, or null.
 *
 * Extracted from `routes/account.ts` when `/sync` became the second consumer.
 * Two copies of this is how one of them ends up checking expiry and the other
 * not: every route that reads user data must resolve identity the same way.
 */
export function authenticator(
  deps: AppDeps,
): (cookieHeader: string | undefined) => Promise<string | null> {
  const name = cookieName(SESSION_COOKIE, deps.secureCookies);

  return async (cookieHeader) => {
    const token = readCookie(cookieHeader, name);
    if (token === null) return null;
    return findSession(deps.query, token);
  };
}
