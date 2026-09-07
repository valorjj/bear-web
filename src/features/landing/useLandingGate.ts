import { useCallback, useState } from 'react';

import { hasLandingBeenSeen, markLandingSeen } from './gate';

export interface LandingGate {
  /** True while the landing screen should be shown instead of the app. */
  open: boolean;
  /** Records the choice and closes the gate for good on this device. */
  dismiss: () => void;
}

/**
 * Whether to show the landing screen, decided once at mount.
 *
 * The flag is read in a lazy initialiser rather than on every render, so the
 * gate's state is owned by React from the first frame and `dismiss` is the
 * only thing that can close it. That matters for the sign-in branch, which
 * dismisses from an effect rather than from a click handler.
 */
export function useLandingGate(): LandingGate {
  const [open, setOpen] = useState(() => !hasLandingBeenSeen());

  const dismiss = useCallback(() => {
    // Written before the state change, not after: the state change can trigger
    // a render that unmounts this hook's owner, and the durable marker must
    // not depend on surviving that.
    markLandingSeen();
    setOpen(false);
  }, []);

  return { open, dismiss };
}
