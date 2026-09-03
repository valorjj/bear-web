import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

import { settings } from '@/data';

import {
  applyTypography,
  DEFAULTS,
  hasTypographyMirror,
  isTypography,
  readTypographyMirror,
  TYPOGRAPHY_KEY,
  type Typography,
  writeTypographyMirror,
} from './typography';

export interface TypographyControl {
  value: Typography;
  set: (next: Typography) => void;
  reset: () => void;
}

/**
 * The settings table is the source of truth; the mirror is a paint-time cache.
 *
 * Shaped like `useTheme` rather than like `useSetting`, and the reason is the
 * flash. `useSetting` renders at its fallback until IndexedDB answers — its
 * own docblock says "one frame at the default beats a blank pane", which is
 * right for a sort order and wrong for a font size, where that frame is the
 * whole note reflowing on every launch. Seeding the live query FROM THE MIRROR
 * is what stops the app disagreeing with the frame it already painted.
 *
 * `useFlushTriggers` is not needed here for the same reason `useTheme` does
 * not need it: the mirror is written synchronously, so a reload landing
 * between the change and the fire-and-forget durable write still reads the
 * user's value.
 *
 * Deps are the constant `[]`, so `useLiveQuery`'s documented
 * previous-deps-for-one-tick behaviour cannot apply.
 */
export function useTypography(): TypographyControl {
  const stored = useLiveQuery(
    () => settings.get<unknown>(TYPOGRAPHY_KEY, readTypographyMirror()),
    [],
    readTypographyMirror(),
  );

  const settled = isTypography(stored) ? stored : DEFAULTS;

  /*
   * The same optimistic slot `useSetting` carries, needed here for a DIFFERENT
   * reason than it needs it, and added because a test failed 5 runs in 10.
   *
   * `useSetting`'s case is two menu clicks each deriving from a stale render.
   * This hook's case is the live query's MOUNT-TIME read resolving after the
   * user has already changed something: it hands back a distinct-but-equal
   * pre-change object, reference inequality re-runs the apply effect below,
   * and the effect rewrites the mirror with the older value. Instrumented
   * rather than guessed — the mirror took three writes, 16 then 20 then 16.
   *
   * **Stated no stronger than it was measured.** The stale mirror is
   * TRANSIENT and self-correcting: the durable write lands a moment later,
   * the live query reports it, and the effect rewrites the mirror correctly.
   * A settle-then-assert test passes 8 times in 8 WITH the bug present, which
   * is what proves the window is narrow — only a reload inside those few
   * milliseconds would paint the old value. So this is not "a flash on every
   * launch"; it is a brief interval in which the paint-time cache disagrees
   * with what the user just chose.
   *
   * It is fixed anyway, for two reasons that are worth more than the window
   * itself: the mirror is the one thing in this design that exists to be
   * correct before anything else runs, and the race made the test file
   * non-deterministic at 3-5 failures in 10 — this repo already carries one
   * intermittent spec nobody can explain, and adding a second is worse than
   * the defect. The slot also removes a redundant re-apply on every settle.
   *
   * No dedicated regression test guards this, and that is recorded rather
   * than papered over: the one written for it passed 8/8 against the
   * unfixed hook and was deleted for being vacuous. What discriminates is
   * `writes the durable row, the mirror and the DOM on set`, which asserts
   * the mirror MID-FLIGHT rather than after a settle — and it does so
   * intermittently, failing roughly 3 runs in 10 against the unfixed hook
   * and 0 in 14 against this one.
   */
  const [optimistic, setOptimistic] = useState<Typography | undefined>(undefined);
  const value = optimistic ?? settled;

  // Dropped only once the live query reports the very value that was written,
  // never eagerly. Compared structurally, because a fresh object from the
  // database is never reference-equal to the one that was written.
  useEffect(() => {
    if (optimistic === undefined) return;
    if (JSON.stringify(settled) === JSON.stringify(optimistic)) setOptimistic(undefined);
  }, [settled, optimistic]);

  /*
   * One repair `useTheme` does NOT make. If the durable row is absent while
   * the mirror holds a preference, `settings.get`'s fallback serves the mirror
   * and nothing ever writes the row — the cache silently becomes the source of
   * truth, and clearing site data loses the preference with no other trace.
   *
   * Four guards, three of them bought by a failing test rather than foreseen.
   *
   * `recoverable` is the important one: healing only means anything when the
   * MIRROR holds a preference and the row is gone. With neither present there
   * is nothing to recover, and writing `DEFAULTS` into the row anyway made the
   * live query report a fresh object, which re-ran this effect and rewrote the
   * mirror — over a value the user had just chosen. `healed` runs it once per
   * mount. `wrote` abandons it the moment the user changes anything, and
   * `latest` supplies the current value rather than the one captured when the
   * effect ran, because the read is ASYNCHRONOUS and a change can land inside
   * the window it leaves open.
   */
  const recoverable = useRef(hasTypographyMirror());
  const healed = useRef(false);
  const wrote = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    applyTypography(value);
    writeTypographyMirror(value);

    if (healed.current || !recoverable.current) return;
    healed.current = true;
    void settings.get<unknown>(TYPOGRAPHY_KEY, null).then((row) => {
      if (row === null && !wrote.current) void settings.set(TYPOGRAPHY_KEY, latest.current);
    });
  }, [value]);

  const set = useCallback((next: Typography) => {
    wrote.current = true;
    setOptimistic(next);
    // Optimistic, and deliberately so, exactly as `useTheme` is: the
    // properties and the mirror move now, the durable write follows. Waiting
    // on IndexedDB would leave a slider visibly lagging its own drag.
    applyTypography(next);
    writeTypographyMirror(next);
    void settings.set(TYPOGRAPHY_KEY, next);
  }, []);

  const reset = useCallback(() => set(DEFAULTS), [set]);

  return { value, set, reset };
}
