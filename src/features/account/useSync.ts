import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createEngine,
  createTransport,
  db,
  parseTags,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from '@/data';
import { useT } from '@/i18n';

import type { SessionState } from './useSession';

export type SyncStatusValue = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncController {
  status: SyncStatusValue;
  /** Set only when `status` is 'error'. A translated, plain sentence. */
  message: string | null;
  lastSyncedAt: number | null;
  syncNow: () => void;
}

/**
 * Sync is "automatic and quiet", not immediate: a run fires this long after
 * the last local write, not on every keystroke.
 */
const EDIT_DEBOUNCE_MS = 2000;

/**
 * Runs the sync engine on a small set of triggers and reports the outcome.
 *
 * Nothing here runs on the render path: the engine is built once in a
 * `useMemo` (its identity would otherwise churn every dependency array below
 * for no reason), and every actual sync happens inside an effect, after
 * first paint.
 */
export function useSync(state: SessionState): SyncController {
  const t = useT();
  const [status, setStatus] = useState<SyncStatusValue>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const accountId = state.status === 'signedIn' ? state.account.userId : null;

  const engine = useMemo(() => createEngine({ db, transport: createTransport(), parseTags }), []);

  // Two concurrent `syncOnce` calls both read the cursor before either
  // writes it, and the second push carries stale `baseRev`s for rows the
  // first already advanced — manufacturing conflict copies out of nothing.
  const runningRef = useRef(false);
  // A session that is gone will be gone for every retry; retrying it on
  // every visibility change is a request loop against a machine in
  // someone's house.
  const stoppedRef = useRef(false);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  const runSync = useCallback(() => {
    const id = accountIdRef.current;
    if (id === null) return;
    if (stoppedRef.current) return;
    if (runningRef.current) return;

    runningRef.current = true;
    setStatus('syncing');
    setMessage(null);

    engine
      .syncOnce(id)
      .then(() => {
        setStatus('idle');
        setMessage(null);
        setLastSyncedAt(Date.now());
      })
      .catch((error: unknown) => {
        if (error instanceof SyncUnauthorizedError) {
          stoppedRef.current = true;
          setStatus('error');
          setMessage(t('sync.error'));
          return;
        }
        if (error instanceof SyncUnavailableError) {
          setStatus('offline');
          setMessage(null);
          return;
        }
        if (error instanceof SyncQuotaError) {
          setStatus('error');
          setMessage(t('sync.quota'));
          return;
        }
        setStatus('error');
        setMessage(t('sync.error'));
      })
      .finally(() => {
        runningRef.current = false;
      });
  }, [engine, t]);

  // Held in a ref, same shape as `useFlushTriggers`' callback ref: listeners
  // below are registered once and still call the latest closure, rather than
  // re-registering (and churning identity) on every render.
  const runRef = useRef(runSync);
  useEffect(() => {
    runRef.current = runSync;
  });

  // A fresh sign-in — possibly as a different account — must not stay
  // permanently blocked by a previous account's 401.
  useEffect(() => {
    stoppedRef.current = false;
  }, [accountId]);

  // Trigger: mount, after first paint. `accountId` in the deps also fires
  // this the moment a signed-out visitor signs in.
  useEffect(() => {
    if (accountId === null) return;
    runRef.current();
  }, [accountId]);

  // Triggers: the tab becoming visible again, and the network coming back.
  // Both are exactly the moments a sleeping machine wakes up.
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') runRef.current();
    };
    const onOnline = (): void => runRef.current();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Trigger: a debounce after local edits settle. Dexie's own table hooks
  // are the signal — reusing them here means no second window/document
  // listener pair is needed just to notice a local write.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => runRef.current(), EDIT_DEBOUNCE_MS);
    };

    db.notes.hook('creating', schedule);
    db.notes.hook('updating', schedule);
    db.notes.hook('deleting', schedule);

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      db.notes.hook('creating').unsubscribe(schedule);
      db.notes.hook('updating').unsubscribe(schedule);
      db.notes.hook('deleting').unsubscribe(schedule);
    };
  }, []);

  const syncNow = useCallback(() => {
    runRef.current();
  }, []);

  return { status, message, lastSyncedAt, syncNow };
}
