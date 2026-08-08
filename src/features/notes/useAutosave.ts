import { useCallback, useEffect, useRef, useState } from 'react';

export const AUTOSAVE_DELAY_MS = 300;

export interface AutosaveOptions {
  /** The text as last persisted. Read once, at mount. */
  initial: string;
  save: (text: string) => Promise<unknown>;
  /** Called instead of a final save when the buffer is empty at unmount. */
  discard?: () => Promise<unknown>;
  delayMs?: number;
}

export interface Autosave {
  text: string;
  setText: (next: string) => void;
  flush: () => void;
  failed: boolean;
}

/**
 * Debounced write-behind for a text buffer.
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
  save,
  discard,
  delayMs = AUTOSAVE_DELAY_MS,
}: AutosaveOptions): Autosave {
  const [text, setTextState] = useState(initial);
  const [failed, setFailed] = useState(false);

  const textRef = useRef(initial);
  const savedRef = useRef(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A currency token for in-flight saves. Comparing *text* cannot tell "I am
  // the latest save" from "my pending text happens to match the current
  // marker" — a rolled-back marker can coincidentally equal an older save's
  // text. A monotonically increasing counter has no such collision: each
  // `flush` claims the next value, and a handler only acts if its claim is
  // still the most recent one when its promise settles.
  const saveSeqRef = useRef(0);

  // The unmount cleanup runs once and must not call a callback captured at
  // mount, so the latest ones are kept in refs.
  const saveRef = useRef(save);
  const discardRef = useRef(discard);
  useEffect(() => {
    saveRef.current = save;
    discardRef.current = discard;
  });

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    cancelTimer();

    const pending = textRef.current;
    if (pending === savedRef.current) return;

    // Marked as saved optimistically, so a second trigger arriving before the
    // write resolves does not duplicate it. Rolled back on failure, which is
    // what makes the next trigger retry rather than skip.
    const previous = savedRef.current;
    savedRef.current = pending;

    const token = ++saveSeqRef.current;

    void saveRef.current(pending).then(
      () => {
        // Superseded: a newer flush has started since this one, so this
        // settlement — success or failure — no longer describes the current
        // buffer. Clearing `failed` here could hide a real failure reported
        // by that newer save behind an unrelated, stale success.
        if (saveSeqRef.current !== token) return;
        setFailed(false);
      },
      () => {
        // Superseded, symmetric to the success branch: rolling back the
        // marker or reporting `failed` here would stomp a correct,
        // already-saved marker and raise a false alarm for a write that has
        // since been superseded and succeeded.
        if (saveSeqRef.current !== token) return;
        savedRef.current = previous;
        setFailed(true);
      },
    );
  }, [cancelTimer]);

  const setText = useCallback(
    (next: string) => {
      textRef.current = next;
      setTextState(next);

      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, delayMs);
    },
    [cancelTimer, delayMs, flush],
  );

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flush]);

  useEffect(() => {
    return () => {
      cancelTimer();

      // An empty buffer means the record holds nothing, so it is purged rather
      // than saved-then-purged. Exactly `''` — no trim, no dirty flag.
      if (textRef.current === '' && discardRef.current !== undefined) {
        void discardRef.current();
        return;
      }

      flush();
    };
  }, [cancelTimer, flush]);

  return { text, setText, flush, failed };
}
