import { beforeEach, describe, expect, it } from 'vitest';

import { isLocale, LOCALE_MIRROR_KEY, readLocaleMirror, writeLocaleMirror } from './localeMirror';

describe('the locale mirror', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips both locales', () => {
    writeLocaleMirror('ko');
    expect(readLocaleMirror()).toBe('ko');
    writeLocaleMirror('en');
    expect(readLocaleMirror()).toBe('en');
  });

  /*
   * `null`, not a default. "Nothing stored" must fall through to
   * `detectLocale` so a Korean browser still gets Korean on first run; a
   * default of 'en' here would silently override language detection for every
   * new visitor, which is the one thing this must not do.
   */
  it('reports absence as null so detection still runs', () => {
    expect(readLocaleMirror()).toBeNull();
  });

  it('treats an unknown or corrupt value as absent', () => {
    localStorage.setItem(LOCALE_MIRROR_KEY, 'jp');
    expect(readLocaleMirror()).toBeNull();
    localStorage.setItem(LOCALE_MIRROR_KEY, '');
    expect(readLocaleMirror()).toBeNull();
  });

  it('guards the two locales and nothing else', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
