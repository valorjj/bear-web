import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { I18nProvider, type Locale } from './context';

/**
 * `useT` throws without a provider, so component tests must supply one. The
 * locale is pinned rather than detected, so a test's expectations do not
 * depend on the machine's language settings.
 */
export function renderWithI18n(ui: ReactNode, locale: Locale = 'en'): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <I18nProvider locale={locale}>{children}</I18nProvider>,
  });
}
