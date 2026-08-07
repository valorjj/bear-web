import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';

import { en, type TranslationKey } from './en';
import { ko } from './ko';

export type Locale = 'ko' | 'en';

const bundles: Record<Locale, Record<TranslationKey, string>> = { en, ko };

/** First supported tag wins; anything unrecognised falls back to English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    if (tag.toLowerCase().startsWith('ko')) return 'ko';
    if (tag.toLowerCase().startsWith('en')) return 'en';
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
  const [locale, setLocale] = useState<Locale>(
    initial ?? detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
  );

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
