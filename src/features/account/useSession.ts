import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type Account,
  deleteAccount as deleteAccountRequest,
  fetchAccount,
  postLogout,
  startGoogleSignIn,
} from './api';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; account: Account }
  | { status: 'unavailable' };

export interface Session {
  state: SessionState;
  signIn: () => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
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
        } catch {
          // Still unreachable: the revocation is still owed, so /me must not
          // be consulted — a signed-in answer here would be the exact leak
          // this marker exists to close. The local intent already stands.
          if (mountedRef.current) setState({ status: 'signedOut' });
          return;
        }
      }

      try {
        const account = await fetchAccount();
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
    if (mountedRef.current) setState({ status: 'signedOut' });
  }, []);

  const signIn = useCallback(() => {
    // Starting a new sign-in supersedes any owed revocation: the intent to
    // sign in is newer than the unfulfilled intent to sign out, and there is
    // no old session left in this browser worth revoking. The navigation
    // ends this JS context, so the marker must clear before it, not after.
    clearPendingLogout();
    startGoogleSignIn();
  }, []);

  const deleteAccount = useCallback(async () => {
    // Deliberately asymmetric with signOut: a failed DELETE must propagate,
    // not report signedOut — that would claim the account is gone when it
    // may still exist. Task 10 handles the error at the call site.
    await deleteAccountRequest();
    if (mountedRef.current) setState({ status: 'signedOut' });
  }, []);

  return { state, signIn, signOut, deleteAccount };
}
