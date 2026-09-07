import type { ReactElement } from 'react';

import type { DatabaseStatus } from '@/data';
import { Landing, useLandingGate } from '@/features/landing';
import { I18nProvider } from '@/i18n';

import { AppShell } from './AppShell';
import { DatabaseStatusProvider } from './DatabaseStatusContext';
import { UnavailableBanner } from './UnavailableBanner';

export default function App({ status }: { status: DatabaseStatus }): ReactElement {
  // A state, not a route. The landing screen has no URL of its own: adding the
  // first client router to this app for one screen would also mean a Pages 404
  // fallback, and there is no second entry point to route to.
  const gate = useLandingGate();

  return (
    <I18nProvider>
      <DatabaseStatusProvider status={status}>
        {gate.open ? (
          <Landing onEnter={gate.dismiss} />
        ) : (
          <div className="flex h-dvh flex-col">
            <UnavailableBanner />
            <div className="min-h-0 flex-1">
              <AppShell />
            </div>
          </div>
        )}
      </DatabaseStatusProvider>
    </I18nProvider>
  );
}
