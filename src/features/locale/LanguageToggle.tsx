import type { ReactElement } from 'react';

import { useLocalePreference } from '@/app/useLocalePreference';
import { useT } from '@/i18n';
import { Icon, Languages } from '@/ui/Icon';

/**
 * Switches between the two bundles, and remembers the choice.
 *
 * **One i18n key, not two.** `locale.switch` always means "switch to the OTHER
 * language", so the English bundle reads "Switch to Korean" and the Korean one
 * reads the reverse — the active bundle is what makes the direction correct.
 * A pair of keys would let the two bundles drift into disagreeing about which
 * way the button goes, and nothing would catch it.
 *
 * Icon-only rather than a "EN"/"한" text toggle, which was the other candidate:
 * a text toggle has to say either the current language or the target one, and
 * whichever it says, half of readers read it the other way round. The glyph
 * says "language" and the accessible name says the direction.
 */
export function LanguageToggle(): ReactElement {
  const t = useT();
  const { locale, setLocale } = useLocalePreference();

  return (
    <button
      type="button"
      aria-label={t('locale.switch')}
      onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
      className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
    >
      <Icon glyph={Languages} size="md" />
    </button>
  );
}
