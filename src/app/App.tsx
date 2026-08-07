import type { ReactElement } from 'react';

import type { DatabaseStatus } from '@/data';
import { I18nProvider } from '@/i18n';

import { AppShell } from './AppShell';
import { DatabaseStatusProvider } from './DatabaseStatusContext';
import { UnavailableBanner } from './UnavailableBanner';

export default function App({ status }: { status: DatabaseStatus }): ReactElement {
  return (
    <I18nProvider>
      <DatabaseStatusProvider status={status}>
        <div className="flex h-dvh flex-col">
          <UnavailableBanner />
          <div className="min-h-0 flex-1">
            <AppShell />
          </div>
        </div>
      </DatabaseStatusProvider>
    </I18nProvider>
  );
}
