import { useCallback, useEffect, useRef, useState } from 'react';

import { useFlushTriggers } from '@/lib/useFlushTriggers';

export const AUTOSAVE_DELAY_MS = 300;

export interface AutosaveOptions {
  /** The text as last persisted. Read once, at mount. */
  initial: string;
  /** Reads the current text. Called at flush time, never stored in state. */
  read: () => string;
  save: (text: string) => Promise<unknown>;
  /** Called instead of a final save when the text is empty at unmount. */
  discard?: () => Promise<unknown>;
  /** Defaults to `text === ''`. */
  isEmpty?: (text: string) => boolean;
  delayMs?: number;
}

export interface Autosave {
  /** Debounces a flush. Call on every change. */
  schedule: () => void;
  flush: () => void;
  failed: boolean;
}

/**
 * Debounced write-behind for text the caller owns.
 *
 * The hook does NOT hold the text. A rich editor owns its document, and keeping
 * a derived Markdown string in React state would re-render the editor on every
 * keystroke. `read` is called at flush time instead.
 *
 * The owning component is expected to be keyed by the record's id, so an
 * instance only ever writes to one record. That is what makes the unmount
 * cleanup a safe flush-on-switch: there is no "current" id to get wrong.
 *
 * `beforeunload` can only *start* an asynchronous write, never wait for one.
 * Up to `delayMs` of typing is lost on a hard kill. `visibilitychange` is the
 * trigger that actually protects the user.
 */
export function useAutosave({
  initial,
  read,
  save,
  discard,
  isEmpty,
  delayMs = AUTOSAVE_DELAY_MS,
}: AutosaveOptions): Autosave {
  const [failed, setFailedState] = useState(false);

  // Mirrors `failed` synchronously. `flush` runs inside a promise callback,
  // where the last-committed React state (not necessarily the latest
  // `setFailed` call) is what a plain closure would see; a ref sidesteps that.
  const failedRef = useRef(false);
  const setFailed = useCallback((value: boolean) => {
    failedRef.current = value;
    setFailedState(value);
  }, []);

  // The text of the most recent write we have STARTED. Deduplicates triggers
  // that arrive while a write is in flight. This check is suppressed while
  // `failedRef` is set: after a failure, `attemptedRef` is rolled back to the
  // confirmed-persisted marker (see below), and the buffer can coincidentally
  // return to exactly that value even though the failed write itself never
  // landed. Trusting the dedupe check there would silently skip a write the
  // user is owed — the hook writes through unconditionally on the next flush
  // until a save actually succeeds again.
  const attemptedRef = useRef(initial);

  // The text of the most recent write that RESOLVED SUCCESSFULLY. This is the
  // rollback target, and the whole point of the redesign: the previous version
  // rolled back to an optimistic marker that could name text never actually
  // written, so a buffer that later coincidentally equalled it would skip a
  // write that had never landed.
  const persistedRef = useRef(initial);
  const persistedSeqRef = useRef(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A currency token for in-flight saves. Comparing *text* cannot tell "I am
  // the latest save" from "my pending text happens to match the current
  // marker". A monotonically increasing counter has no such collision.
  const saveSeqRef = useRef(0);

  // The unmount cleanup runs once and must not call callbacks captured at
  // mount, so the latest ones are kept in refs.
  const readRef = useRef(read);
  const saveRef = useRef(save);
  const discardRef = useRef(discard);
  const isEmptyRef = useRef(isEmpty);
  useEffect(() => {
    readRef.current = read;
    saveRef.current = save;
    discardRef.current = discard;
    isEmptyRef.current = isEmpty;
  });

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    cancelTimer();

    const pending = readRef.current();
    if (!failedRef.current && pending === attemptedRef.current) return;

    attemptedRef.current = pending;
    const token = ++saveSeqRef.current;

    void saveRef.current(pending).then(
      () => {
        // Advance the confirmed marker only if no LATER write has already
        // confirmed. Same-store IndexedDB writes resolve in issue order, so
        // this guard should never fire — it costs nothing and removes the
        // dependency on that ordering guarantee.
        if (token > persistedSeqRef.current) {
          persistedSeqRef.current = token;
          persistedRef.current = pending;
        }

        // Superseded: a newer flush has started, so this settlement no longer
        // describes the current text. Clearing `failed` here could hide a real
        // failure reported by that newer save behind an unrelated stale success.
        if (saveSeqRef.current !== token) return;
        setFailed(false);
      },
      () => {
        // Superseded, symmetric to the success branch.
        if (saveSeqRef.current !== token) return;

        // Roll the dedupe baseline back to what is CONFIRMED on disk, so the
        // next trigger retries rather than skipping.
        attemptedRef.current = persistedRef.current;
        setFailed(true);
      },
    );
  }, [cancelTimer, setFailed]);

  const schedule = useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, delayMs);
  }, [cancelTimer, delayMs, flush]);

  useFlushTriggers(flush);

  useEffect(() => {
    return () => {
      cancelTimer();

      // Empty means the record holds nothing, so it is purged rather than
      // saved-then-purged. Still exactly one comparison — no trim, no dirty
      // flag — with the comparison value supplied by the caller.
      const current = readRef.current();
      const empty = isEmptyRef.current?.(current) ?? current === '';

      if (empty && discardRef.current !== undefined) {
        void discardRef.current();
        return;
      }

      flush();
    };
  }, [cancelTimer, flush]);

  return { schedule, flush, failed };
}
