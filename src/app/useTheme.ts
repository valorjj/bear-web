import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';

import { settings } from '@/data';

import { applyTheme, readMirror, THEME_KEY, type ThemeChoice, writeMirror } from './theme';

export interface ThemeControl {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

/**
 * The settings table is the source of truth; the mirror is a paint-time cache.
 *
 * On boot the stored value wins and the mirror is rewritten from it, so a
 * mirror edited by hand, or left behind by an older build, cannot outlive one
 * launch. Seeding the live query from the mirror rather than from a constant
 * matters: the mirror already painted the first frame, so seeding from
 * anything else would make the app disagree with itself until IndexedDB
 * answered.
 *
 * Deps are the constant `[]`, so `useLiveQuery`'s documented
 * previous-deps-for-one-tick behaviour cannot apply and the tag-and-verify
 * pattern would be dead complexity here.
 */
export function useTheme(): ThemeControl {
  const stored = useLiveQuery(
    () => settings.get<ThemeChoice>(THEME_KEY, readMirror()),
    [],
    readMirror(),
  );

  useEffect(() => {
    applyTheme(stored);
    writeMirror(stored);
  }, [stored]);

  return {
    choice: stored,
    setChoice: (choice) => {
      // Optimistic, and deliberately so: the attribute and the mirror move now,
      // the durable write follows. Waiting on IndexedDB would leave the picker
      // visibly lagging its own click.
      applyTheme(choice);
      writeMirror(choice);
      void settings.set(THEME_KEY, choice);
    },
  };
}
