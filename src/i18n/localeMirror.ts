import type { Locale } from './context';

/**
 * The paint-time cache for the reader's language.
 *
 * Namespaced like the theme's, because `localStorage` is origin-wide and this
 * app shares an origin with everything else on github.io.
 *
 * This lives in `src/i18n/` rather than beside the theme's mirror in
 * `src/app/` for one reason: `I18nProvider` needs it during its FIRST render,
 * and a provider that imported from `src/app/` would drag the application
 * layer into every test that renders a translated component. It touches
 * `localStorage` and nothing else — no Dexie, no React.
 */
export const LOCALE_MIRROR_KEY = 'bear-web:locale';

/** The durable record's key in the settings table. */
export const LOCALE_KEY = 'locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ko';
}

/**
 * `null` rather than a default, because "no preference stored" and "the reader
 * chose English" are different states: the first must fall through to
 * `detectLocale`, and the second must not.
 */
export function readLocaleMirror(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_MIRROR_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Private-mode Safari and some embedded webviews throw on access rather
    // than returning null. A language preference must never break boot.
    return null;
  }
}

export function writeLocaleMirror(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_MIRROR_KEY, locale);
  } catch {
    // Ignored: the settings table is the source of truth. Losing the mirror
    // costs one launch in the detected language, not the preference.
  }
}
