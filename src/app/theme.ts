import { THEMES, type ThemeId } from '@/styles/themes';

export type ThemeChoice = ThemeId | 'system';

/** The durable record's key in the settings table. */
export const THEME_KEY = 'theme';

/**
 * The paint-time cache's key. Namespaced because `localStorage` is origin-wide
 * and this app shares an origin with everything else on github.io.
 */
export const MIRROR_KEY = 'bear-web:theme';

function isChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || THEMES.some((theme) => theme.id === value);
}

/**
 * Reads the paint-time mirror.
 *
 * An unknown value degrades to `system` rather than reaching `data-theme`: the
 * mirror is written by one script that runs before React and read by another,
 * and a stale entry left by an older build would otherwise select a block that
 * no longer exists and paint the app unstyled.
 */
export function readMirror(): ThemeChoice {
  try {
    const stored = localStorage.getItem(MIRROR_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Private-mode Safari and some embedded webviews throw on access rather
    // than returning null. A theme preference must never break boot.
    return 'system';
  }
}

export function writeMirror(choice: ThemeChoice): void {
  try {
    localStorage.setItem(MIRROR_KEY, choice);
  } catch {
    // Ignored: the settings table is the source of truth. Losing the mirror
    // costs a flash on the next launch, not the preference.
  }
}

/**
 * `system` is the ABSENCE of the attribute, never `data-theme="system"`.
 *
 * The dark block is guarded on `:root:not([data-theme])`, so any attribute
 * value at all suppresses it — a literal "system" would match no theme block,
 * leave the `:root` fallback in force, and paint a light app for someone whose
 * OS is dark.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
