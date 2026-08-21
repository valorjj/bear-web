import { useCallback, useEffect, useState } from 'react';

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
 * Session state, resolved after mount.
 *
 * The fetch lives in an effect and the initial state is `loading`, so the first
 * render is synchronous and the app's boot guarantee holds: nothing here can
 * delay paint, and a Mini that never answers leaves the app fully usable.
 *
 * `unavailable` is deliberately distinct from `signedOut`. For a machine that
 * sleeps, unreachable is the NORMAL case, and telling a signed-in user they are
 * signed out every time it naps would be a lie the UI then repeats back.
 */
export function useSession(): Session {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const account = await fetchAccount();
        if (cancelled) return;
        setState(account === null ? { status: 'signedOut' } : { status: 'signedIn', account });
      } catch {
        if (!cancelled) setState({ status: 'unavailable' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await postLogout();
    } catch {
      // The cookie may already be gone, or the server may be asleep. Either
      // way the local intent is "signed out", and refusing to reflect that
      // would strand the user in a state they explicitly left.
    }
    setState({ status: 'signedOut' });
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountRequest();
    setState({ status: 'signedOut' });
  }, []);

  return { state, signIn: startGoogleSignIn, signOut, deleteAccount };
}
