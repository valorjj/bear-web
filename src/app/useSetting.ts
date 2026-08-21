import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

import { settings } from '@/data';
import { useFlushTriggers } from '@/lib/useFlushTriggers';

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
 * `useFlushTriggers` IS needed, for the second reason and not the first. The
 * write is `void settings.set(...)` — issued, not awaited — so choosing a
 * preference and reloading immediately could lose it, which is the very defect
 * `usePaneWidths` carried as a deferred ruling until it was resolved this way.
 * An earlier version of this hook claimed the write was awaited and skipped the
 * flush; a Playwright test that chose a density and reloaded caught it, failing
 * roughly one run in ten. `lastWritten` is re-issued on the flush triggers, at
 * the cost of one redundant write, exactly as `usePaneWidths` does.
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

  // The last value handed to `settings.set`. See the docblock: the write is
  // fire-and-forget, so a reload landing between the click and the write
  // losing the race would drop the preference.
  const lastWritten = useRef<T | undefined>(undefined);

  const set = useCallback(
    (next: T) => {
      setOptimistic(next);
      lastWritten.current = next;
      void settings.set(key, next);
    },
    [key],
  );

  useFlushTriggers(() => {
    if (lastWritten.current !== undefined) void settings.set(key, lastWritten.current);
  });

  return [value, set];
}
