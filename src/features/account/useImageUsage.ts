import { useEffect, useState } from 'react';

import { fetchImageUsage, type ImageUsage } from './api';

/**
 * This account's image usage, fetched when `enabled` becomes true.
 *
 * Fetched on demand — when the account menu opens — rather than on sign-in.
 * The figure is only ever read in one place, it changes slowly, and a request
 * fired at boot would be one more thing between a cold start and a usable app
 * on a local-first product whose whole point is that it works without the
 * server.
 *
 * `null` covers three cases the caller treats identically: not asked yet, not
 * signed in, and the server could not be reached. None of them is worth its
 * own message in a menu row — a meter that cannot be drawn is simply absent,
 * where an error line would be noise on a surface the user opened to do
 * something else.
 */
export function useImageUsage(enabled: boolean): ImageUsage | null {
  const [usage, setUsage] = useState<ImageUsage | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Guarded against a resolve that lands after the menu closed, and against
    // React StrictMode's phantom double-mount — the pattern `useSession`
    // needed, where a cleanup that falsified its ref permanently left the app
    // stuck on "loading" with every gate passing.
    let live = true;
    void fetchImageUsage()
      .then((next) => {
        if (live) setUsage(next);
      })
      .catch(() => {
        if (live) setUsage(null);
      });

    return () => {
      live = false;
    };
  }, [enabled]);

  return usage;
}
