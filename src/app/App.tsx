import { useEffect, type ReactElement } from 'react';

import type { DatabaseStatus } from '@/data';
import { ImportGate, stashPendingImportId } from '@/features/import';
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

  // Unconditional — runs whichever branch below is showing, which is the
  // whole point. A first-time visitor sees Landing FIRST, and its "Sign in
  // with Google" button is a full navigation away from this origin
  // (`startGoogleSignIn`) that can happen before `ImportGate` (mounted only
  // in the other branch, deliberately) ever gets a chance to read
  // `?import=<id>` from the URL. Without this call, that round trip drops
  // the id with nothing left to recover on the way back. See
  // `stashPendingImportId`'s own doc for the full reasoning.
  useEffect(() => {
    stashPendingImportId();
  }, []);

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
            {/*
              AFTER the landing gate, deliberately. A link recipient is by
              definition a first-time visitor, so mounting this in the other
              branch would open a modal behind the landing screen.
            */}
            <ImportGate />
          </div>
        )}
      </DatabaseStatusProvider>
    </I18nProvider>
  );
}
