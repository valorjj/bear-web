import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createEngine,
  createTransport,
  db,
  LAST_PULLED_REV_KEY,
  markAllDirty,
  notes,
  parseLinks,
  parseTags,
  SYNCED_ACCOUNT_KEY,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from '@/data';
import { useT } from '@/i18n';

import type { SessionState } from './useSession';

export type SyncStatusValue = 'idle' | 'syncing' | 'offline' | 'error';

/** Set while a first sync into an account is blocked on the user's answer. */
export interface PendingAdoption {
  /** Local notes waiting to be added or discarded. */
  count: number;
}

export interface SyncController {
  status: SyncStatusValue;
  /** Set only when `status` is 'error'. A translated, plain sentence. */
  message: string | null;
  lastSyncedAt: number | null;
  syncNow: () => void;
  /**
   * Non-null exactly while `AdoptNotesDialog` must be shown: this device
   * holds local notes it has never synced to the account now signed in — a
   * genuinely new sign-in, or an account switch on a device that still
   * carries a previous account's notes. Sync is blocked until `onAdopt` or
   * `onDiscard` is called.
   */
  adoption: PendingAdoption | null;
  /** Marks every local note and tag dirty, then lets sync proceed. */
  onAdopt: () => void;
  /** Purges every local note (through the `notes` repository), then syncs. */
  onDiscard: () => void;
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
  const [adoption, setAdoption] = useState<PendingAdoption | null>(null);

  const accountId = state.status === 'signedIn' ? state.account.userId : null;

  const engine = useMemo(
    () => createEngine({ db, transport: createTransport(), parseTags, parseLinks }),
    [],
  );

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

  // Holds the account id an open `AdoptNotesDialog` is waiting on. Non-null
  // blocks `runSync` the same way `runningRef` does, so mount, visibility,
  // online and the edit debounce all no-op while the dialog is up instead of
  // racing the user's answer.
  const adoptionRef = useRef<{ accountId: string; count: number } | null>(null);

  const reportOutcome = useCallback(() => {
    setStatus('idle');
    setMessage(null);
    setLastSyncedAt(Date.now());
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
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
    },
    [t],
  );

  const runSync = useCallback(() => {
    const id = accountIdRef.current;
    if (id === null) return;
    if (stoppedRef.current) return;
    if (runningRef.current) return;
    if (adoptionRef.current !== null) return;

    runningRef.current = true;
    setStatus('syncing');
    setMessage(null);

    void (async () => {
      try {
        // Adoption blocks the FIRST sync for a given account, and only that
        // one: once `SYNCED_ACCOUNT_KEY` matches, every later run skips
        // straight to `syncOnce`. Syncing before asking would push a guest's
        // (or a previous account's) notes into this account silently — the
        // outcome the spec rejects.
        const stored = await db.settings.get(SYNCED_ACCOUNT_KEY);
        if (stored?.value !== id) {
          const count = await db.notes.count();
          // Tags count as local data too, even though the dialog's copy talks
          // about notes: a guest can hold tag metadata (order, icon,
          // collapsed) with no notes left behind it, and gating on notes
          // alone means `markAllDirty` never runs for them and those rows are
          // never pushed at all. `count` stays the NOTE count because that is
          // what the dialog's sentence is about.
          const local = count + (await db.tags.count());
          if (local > 0) {
            // Zero local notes and tags falls through with nothing recorded here:
            // `engine.syncOnce` below reads the cursor first and, finding a
            // new account, records it and resets `LAST_PULLED_REV_KEY`
            // itself — the same "record the account" this branch would
            // otherwise duplicate.
            adoptionRef.current = { accountId: id, count };
            setAdoption({ count });
            setStatus('idle');
            return;
          }
        }

        await engine.syncOnce(id);
        reportOutcome();
      } catch (error) {
        reportError(error);
      } finally {
        runningRef.current = false;
      }
    })();
  }, [engine, reportError, reportOutcome]);

  // Held in a ref, same shape as `useFlushTriggers`' callback ref: listeners
  // below are registered once and still call the latest closure, rather than
  // re-registering (and churning identity) on every render.
  const runRef = useRef(runSync);
  useEffect(() => {
    runRef.current = runSync;
  });

  // A fresh sign-in — possibly as a different account — must not stay
  // permanently blocked by a previous account's 401, or by a dialog raised
  // for an account that is no longer the one signed in.
  useEffect(() => {
    stoppedRef.current = false;
    adoptionRef.current = null;
    setAdoption(null);
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

  /**
   * Records the answered account and clears the block, then reschedules a
   * run. Both branches below call this rather than writing `syncOnce`
   * directly, so a rejected sync after the decision reports through the
   * normal `status`/`message` path exactly like any other run.
   */
  const resolveAdoption = useCallback(async (pendingAccountId: string) => {
    await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: pendingAccountId });
    await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 0 });
    adoptionRef.current = null;
    setAdoption(null);
    runRef.current();
  }, []);

  const onAdopt = useCallback(() => {
    const pending = adoptionRef.current;
    if (pending === null) return;
    void (async () => {
      await markAllDirty(db, Date.now());
      await resolveAdoption(pending.accountId);
    })();
  }, [resolveAdoption]);

  const onDiscard = useCallback(() => {
    const pending = adoptionRef.current;
    if (pending === null) return;
    void (async () => {
      // Through `notes.purge`, never raw Dexie, so the tag index, folds and
      // any files a note owns are cleaned up along with the row itself.
      const ids = await db.notes.toCollection().primaryKeys();
      for (const id of ids) await notes.purge(id as string);
      await resolveAdoption(pending.accountId);
    })();
  }, [resolveAdoption]);

  return { status, message, lastSyncedAt, syncNow, adoption, onAdopt, onDiscard };
}
