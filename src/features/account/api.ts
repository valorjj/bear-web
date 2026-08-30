import { API_ORIGIN } from '@/data';

export interface Account {
  userId: string;
  email: string | null;
}

/** Thrown when the server could not be reached at all, as opposed to refusing. */
export class ServerUnavailableError extends Error {}

/**
 * The one place `credentials: 'include'` is written.
 *
 * Without it the browser sends no cookie and every call is anonymous — a
 * failure that looks exactly like being signed out, which is the hardest kind
 * to diagnose.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_ORIGIN}${path}`, { ...init, credentials: 'include' });
  } catch (cause) {
    throw new ServerUnavailableError(`cannot reach ${API_ORIGIN}`, { cause });
  }
}

/** The current account, or null when the server says nobody is signed in. */
export async function fetchAccount(): Promise<Account | null> {
  const response = await call('/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new ServerUnavailableError(`/me returned ${response.status}`);
  return (await response.json()) as Account;
}

/**
 * Revokes the session server-side.
 *
 * A non-OK response MUST throw. `useSession.signOut` records the owed
 * revocation only when this rejects, so a swallowed 403 from the origin guard
 * or 429 from the rate limiter would report `signedOut` while the session row
 * and cookie both still live — and the next `/me` would quietly sign the user
 * back in. Refusals are as much a failure to revoke as an unreachable host.
 */
export async function postLogout(): Promise<void> {
  const response = await call('/auth/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) {
    throw new ServerUnavailableError(`/auth/logout returned ${response.status}`);
  }
}

export interface ImageUsage {
  /** Bytes this account's images occupy on the server. */
  used: number;
  /** The quota, read from the server rather than hardcoded here. */
  limit: number;
}

/**
 * How much of the image quota this account has used.
 *
 * `limit` comes from the server on purpose. Hardcoding the figure on both
 * sides is how a meter comes to show a percentage of the wrong denominator
 * after someone changes the quota, and nothing would fail.
 *
 * Returns `null` rather than throwing when the caller is not signed in: a
 * signed-out visitor has no usage, which is not an error condition.
 */
export async function fetchImageUsage(): Promise<ImageUsage | null> {
  const response = await call('/files/usage');
  if (response.status === 401) return null;
  if (!response.ok) throw new ServerUnavailableError(`/files/usage returned ${response.status}`);
  return (await response.json()) as ImageUsage;
}

/** Full-page navigation, because an OAuth redirect cannot happen in `fetch`. */
export function startGoogleSignIn(): void {
  window.location.assign(`${API_ORIGIN}/auth/google`);
}
