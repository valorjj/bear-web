import { API_ORIGIN } from './config';

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

export async function postLogout(): Promise<void> {
  await call('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
}

export async function deleteAccount(): Promise<void> {
  const response = await call('/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok && response.status !== 204) {
    throw new ServerUnavailableError(`/account returned ${response.status}`);
  }
}

/** Full-page navigation, because an OAuth redirect cannot happen in `fetch`. */
export function startGoogleSignIn(): void {
  window.location.assign(`${API_ORIGIN}/auth/google`);
}
