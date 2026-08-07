import type { ReactElement } from 'react';

import { I18nProvider } from '@/i18n';

import { AppShell } from './AppShell';

export default function App(): ReactElement {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
