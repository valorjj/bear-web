import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';

import { settings } from '@/data';

/**
 * One durable preference from the `settings` table.
 *
 * Deliberately NOT modelled on `usePaneWidths`. That hook's `drag`,
 * `pendingCommit` and `lastCommitted` machinery exists to absorb a continuous
 * pointer drag, and to close the window `settings.set`'s fire-and-forget write
 * leaves open mid-drag. A menu click is one discrete event with nothing to
 * render optimistically, so there is no optimistic overlay to reconcile and no
 * need for `useFlushTriggers`.
 *
 * `guard` runs on every read. A row written by a future version — or edited by
 * hand in devtools — must fall back rather than reach a consumer that cannot
 * handle it: `compareNotes` switches exhaustively over its field, so an unknown
 * one would fall through every arm and leave the comparator's result undefined.
 */
export function useSetting<T>(
  key: string,
  fallback: T,
  guard: (value: unknown) => value is T,
): [T, (next: T) => void] {
  // Render at the fallback immediately rather than blocking on IndexedDB — one
  // frame at the default beats a blank pane.
  const stored = useLiveQuery(() => settings.get<unknown>(key, fallback), [key], fallback);

  const value = guard(stored) ? stored : fallback;

  const set = useCallback(
    (next: T) => {
      void settings.set(key, next);
    },
    [key],
  );

  return [value, set];
}
