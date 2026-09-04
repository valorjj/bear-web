import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { en, type TranslationKey } from './en';
import { ko } from './ko';
import { readLocaleMirror } from './localeMirror';

export type Locale = 'ko' | 'en';

const bundles: Record<Locale, Record<TranslationKey, string>> = { en, ko };

/**
 * First supported tag wins; anything unrecognised falls back to English.
 *
 * Compares only the primary subtag (the part before the first `-`) so a tag
 * like `kok` (Kokni) is never mistaken for Korean just because it starts with
 * "ko" — a plain `startsWith` check would misread it.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (primary === 'ko') return 'ko';
    if (primary === 'en') return 'en';
  }
  return 'en';
}

interface I18nValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  locale: initial,
}: {
  children: ReactNode;
  locale?: Locale;
}): ReactElement {
  /*
   * Precedence: an explicit prop (tests), then the reader's own stored choice,
   * then browser detection. The mirror is read SYNCHRONOUSLY here, during the
   * first render, so a reader who chose a language never sees one frame of the
   * detected one before it swaps — the same reason `index.html` applies the
   * theme before first paint, minus the need for an inline script, because no
   * app text is painted until React mounts.
   *
   * The durable row in the settings table is the source of truth and is read
   * by `useLocalePreference`; this mirror is a cache that exists only to make
   * that read invisible.
   */
  const [locale, setLocale] = useState<Locale>(
    () =>
      initial ??
      readLocaleMirror() ??
      detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
  );

  // Keep the document's declared language in sync with what is actually
  // rendered. `index.html` ships a reasonable static default, but only this
  // provider knows the active locale, so it is the one that must own
  // `documentElement.lang` from here on (Finding 2).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key) => bundles[locale][key] }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useT and useLocale require an I18nProvider ancestor.');
  return value;
}

export function useT(): (key: TranslationKey) => string {
  return useI18n().t;
}

export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
