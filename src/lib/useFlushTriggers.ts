import { useEffect, useRef } from 'react';

/**
 * Runs `flush` when the page is about to go away.
 *
 * `beforeunload` can only *start* an asynchronous write, never wait for one, so
 * it is best-effort. `visibilitychange` is the trigger that actually protects
 * the user: it fires on tab switch and on mobile backgrounding, with time to
 * complete.
 *
 * The callback is held in a ref so the listeners are registered exactly once
 * and still call the latest closure. Re-registering on every render would be
 * correct but churns listeners on a hot path.
 */
export function useFlushTriggers(flush: () => void): void {
  const flushRef = useRef(flush);

  useEffect(() => {
    flushRef.current = flush;
  });

  useEffect(() => {
    const run = (): void => flushRef.current();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') run();
    };

    window.addEventListener('beforeunload', run);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', run);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
