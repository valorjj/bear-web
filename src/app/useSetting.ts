import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';

import { settings } from '@/data';

/**
 * One durable preference from the `settings` table.
 *
 * Simpler than `usePaneWidths` but not free of its central problem. That hook's
 * machinery exists to absorb a continuous pointer drag AND to close the window
 * `settings.set`'s fire-and-forget write leaves open. Only the first of those
 * is irrelevant here — a menu click has nothing to render optimistically
 * mid-gesture — and skipping the second cost a real bug:
 *
 *   Two menu clicks in quick succession each derive their new value from the
 *   RENDERED one. Choosing "Title" and then flipping "Newest first" wrote
 *   `{field: 'title'}` and then, from a still-stale render, `{field:
 *   'updated', newestFirst: false}` — silently discarding the field the user
 *   had just chosen. Reproduced as an intermittent failure in
 *   `AppShell.test.tsx` before it was found by reasoning.
 *
 * `optimistic` closes that: it is the value this hook last wrote, and it wins
 * over the stored one until the live query reports the write has landed. Every
 * read after a write therefore sees the write, so a value derived from `value`
 * is never derived from a stale one.
 *
 * `useFlushTriggers` is still not needed: unlike a drag, a click's write is
 * issued once and never superseded by a later frame of the same gesture.
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
  const [optimistic, setOptimistic] = useState<T | undefined>(undefined);

  const settled = guard(stored) ? stored : fallback;
  const value = optimistic ?? settled;

  // Dropped only once the live query reports the very value that was written,
  // never eagerly on the write: clearing early would show the stored value for
  // a frame, which is the flash `usePaneWidths` documents.
  //
  // Compared structurally, because these values are small plain objects
  // (`NoteOrder`) as well as primitives, and a fresh object from the database
  // is never reference-equal to the one that was written.
  useEffect(() => {
    if (optimistic === undefined) return;
    if (JSON.stringify(settled) === JSON.stringify(optimistic)) setOptimistic(undefined);
  }, [settled, optimistic]);

  const set = useCallback(
    (next: T) => {
      setOptimistic(next);
      void settings.set(key, next);
    },
    [key],
  );

  return [value, set];
}
