import { useCallback, useEffect, useRef } from 'react';

import { settings } from '@/data';
import {
  isLocale,
  LOCALE_KEY,
  type Locale,
  readLocaleMirror,
  useLocale,
  writeLocaleMirror,
} from '@/i18n';

export interface LocaleControl {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

/**
 * The durable half of the language preference.
 *
 * `I18nProvider` already owns the locale STATE and reads the `localStorage`
 * mirror synchronously, which is what makes the first frame correct. This adds
 * the settings row — the source of truth, per the repo's rule that IndexedDB
 * holds durable data — and the one recovery path the mirror needs.
 *
 * **The stored row is read only when the mirror is ABSENT**, and that is an
 * optimisation rather than a correctness guard — said plainly, because
 * `useTypography`'s equivalent IS a correctness guard and the two look alike.
 * There, recovery WROTE the row and doing so when nothing needed recovering
 * clobbered a fresh choice. Here recovery only reads, and with the mirror
 * present the row necessarily matches it (they are written together), so
 * dropping this guard changes nothing except one wasted IndexedDB read per
 * mount. Removing it fails no assertion about behaviour, so
 * `LanguageToggle.test.tsx` pins the read count instead of pretending the
 * guard protects something it does not.
 *
 * What DOES protect a fresh choice is `touched`: the read is asynchronous, so
 * a click landing before it resolves must win, or a stale row silently undoes
 * it.
 *
 * There is deliberately no `useLiveQuery` here. A locale can change from
 * exactly one place in this app, and that place calls `set` below; observing
 * the table would add a re-render path with nothing to observe.
 */
export function useLocalePreference(): LocaleControl {
  const { locale, setLocale } = useLocale();

  // Read once, at mount, before anything here can write one.
  const recoverable = useRef(readLocaleMirror() === null);
  const touched = useRef(false);
  const applied = useRef(false);

  /*
   * The CURRENT locale, not the one captured when the effect ran.
   *
   * Without this the recovery below compares the stored row against a stale
   * closure value, and with only two locales that staleness happens to make
   * the `touched` guard unreachable — the guard tested clean because an
   * accident was doing its job. Reading through a ref makes the comparison
   * mean what it says, which also makes `touched` the thing actually
   * protecting a click, and therefore something a test can falsify.
   */
  const current = useRef(locale);
  current.current = locale;

  useEffect(() => {
    if (!recoverable.current || applied.current) return;
    applied.current = true;
    void settings.get<unknown>(LOCALE_KEY, null).then((row) => {
      if (touched.current) return;
      if (isLocale(row) && row !== current.current) {
        setLocale(row);
        writeLocaleMirror(row);
      }
    });
    // `applied` is what makes this once-per-mount, so the dependency list can
    // stay honest rather than being silenced. `locale` is deliberately absent:
    // it is read through `current` at resolution time instead.
  }, [setLocale]);

  const set = useCallback(
    (next: Locale) => {
      touched.current = true;
      // Optimistic and synchronous, exactly as `useTheme` and `useTypography`
      // are: the UI and the mirror move now, the durable write follows.
      setLocale(next);
      writeLocaleMirror(next);
      void settings.set(LOCALE_KEY, next);
    },
    [setLocale],
  );

  return { locale, setLocale: set };
}
