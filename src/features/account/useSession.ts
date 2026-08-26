import { useCallback, useEffect, useRef, useState } from 'react';

import { SESSION_HINT_KEY } from '@/data';

import { type Account, fetchAccount, postLogout, startGoogleSignIn } from './api';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; account: Account }
  | { status: 'unavailable' };

export interface Session {
  state: SessionState;
  signIn: () => void;
  signOut: () => Promise<void>;
}

/**
 * Marks a logout the server has not yet confirmed.
 *
 * `signOut` always honours the local intent and reports `signedOut`
 * immediately, even when the server cannot be reached — refusing to would
 * strand the user in a state they explicitly left. But an unreachable server
 * still has a live session row and cookie, and a later `fetchAccount()` (a
 * remount, a reload) would resolve straight back to `signedIn` — the user
 * was told they signed out, and then quietly is not. This marker records the
 * unfinished revocation so the next mount retries it before ever consulting
 * `/me`.
 */
export const PENDING_LOGOUT_KEY = 'bear-web:account:pendingLogout';

/**
 * Marks a browser that has signed in at least once.
 *
 * Without it, `AccountMenu` being mounted in the shell meant EVERY page load
 * by EVERY visitor fired a cross-origin `GET /me` — a permanent console error
 * for anyone offline or with no API to reach (it turned `e2e/smoke.spec.ts`
 * red on `net::ERR_NAME_NOT_RESOLVED`), and an announcement of that visitor's
 * browser to the API for no benefit at all. A visitor who has never signed in
 * has nothing to resolve, so nothing is requested.
 *
 * It gates only `/me`. A pending revocation is retried regardless: an owed
 * logout matters more than a saved request.
 */
// Re-exported, not redefined: the canonical constant lives in
// `src/data/sync/config.ts` because the data layer needs it too and cannot
// import from here.
export { SESSION_HINT_KEY };

/**
 * `localStorage` throws outright in some contexts (private windows, blocked
 * site data). A missing or unreadable marker must behave exactly like no
 * marker at all.
 */
function hasPendingLogout(): boolean {
  try {
    return localStorage.getItem(PENDING_LOGOUT_KEY) === '1';
  } catch {
    return false;
  }
}

function markPendingLogout(): void {
  try {
    localStorage.setItem(PENDING_LOGOUT_KEY, '1');
  } catch {
    // Best effort. If storage is unavailable there is nothing durable to do;
    // the in-memory `signedOut` state still holds for this session.
  }
}

function clearPendingLogout(): void {
  try {
    localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    // Nothing to clear if storage never accepted the write.
  }
}

function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionHint(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Best effort, exactly as for the pending-logout marker. The cost of a
    // lost hint is one unresolved session at the next boot, not a wrong state.
  }
}

function clearSessionHint(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing to clear if storage never accepted the write.
  }
}

/**
 * Session state, resolved after mount.
 *
 * The fetch lives in an effect and the initial state is `loading`, so the
 * first render is synchronous and the app's boot guarantee holds: nothing
 * here can delay paint, and a Mini that never answers leaves the app fully
 * usable.
 *
 * `unavailable` is deliberately distinct from `signedOut`. For a machine that
 * sleeps, unreachable is the NORMAL case, and telling a signed-in user they
 * are signed out every time it naps would be a lie the UI then repeats back.
 */
export function useSession(): Session {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const mountedRef = useRef(true);

  // Merged into one effect deliberately: in dev StrictMode React mounts,
  // cleans up, and remounts every effect once to test resilience. A
  // cleanup-only effect that never re-sets `mountedRef.current = true` on
  // that phantom remount left the ref permanently false, so the session
  // fetch below (a second, separate effect) would resolve after the guard
  // had already been falsified and its `setState` calls were silently
  // skipped forever. Setting it true on mount, in the same effect that
  // clears it on unmount, keeps the original intent (no `setState` after a
  // REAL unmount) while surviving the phantom one.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      if (hasPendingLogout()) {
        try {
          await postLogout();
          clearPendingLogout();
          clearSessionHint();
        } catch {
          // Still unreachable: the revocation is still owed, so /me must not
          // be consulted — a signed-in answer here would be the exact leak
          // this marker exists to close. The local intent already stands.
          if (mountedRef.current) setState({ status: 'signedOut' });
          return;
        }
      }

      // No session was ever established from this browser, so there is
      // nothing for `/me` to tell us. Resolve, rather than sit in `loading`
      // forever: the menu must still say "not signed in" and offer sign-in.
      if (!hasSessionHint()) {
        if (mountedRef.current) setState({ status: 'signedOut' });
        return;
      }

      try {
        const account = await fetchAccount();
        if (account === null) clearSessionHint();
        else markSessionHint();
        if (!mountedRef.current) return;
        setState(account === null ? { status: 'signedOut' } : { status: 'signedIn', account });
      } catch {
        if (mountedRef.current) setState({ status: 'unavailable' });
      }
    })();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await postLogout();
      clearPendingLogout();
    } catch {
      // The server may be asleep or unreachable. The local intent is still
      // "signed out", so that is reported now; the marker ensures the actual
      // revocation is retried the moment the server can be reached.
      markPendingLogout();
    }
    clearSessionHint();
    if (mountedRef.current) setState({ status: 'signedOut' });
  }, []);

  const signIn = useCallback(() => {
    // Starting a new sign-in supersedes any owed revocation: the intent to
    // sign in is newer than the unfulfilled intent to sign out, and there is
    // no old session left in this browser worth revoking. The navigation
    // ends this JS context, so the marker must clear before it, not after.
    clearPendingLogout();
    // Written BEFORE the navigation, which ends this JS context: the redirect
    // back from the provider boots a fresh app that must know to consult
    // `/me`. Nothing after `assign` reliably runs.
    markSessionHint();
    startGoogleSignIn();
  }, []);

  return { state, signIn, signOut };
}
