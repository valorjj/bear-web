import { useEffect, type ReactElement } from 'react';

import { hasSignedInBefore } from '@/data';
import { SessionProvider, useSessionValue } from '@/features/account';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';

import { GoogleMark } from './GoogleMark';

export interface LandingProps {
  /** Closes the gate. Called once a choice has actually been completed. */
  onEnter: () => void;
}

/**
 * The first-visit door.
 *
 * It mounts its OWN `SessionProvider` rather than reading one from above.
 * `AppShell` mounts its own too, and the two are branches of the same ternary
 * in `App`, so there is never more than one live `useSession` — hoisting the
 * provider into `App` instead would have meant editing `AppShell` and the four
 * bare `<AppShell />` renders in `AppShell.test.tsx` that rely on it being
 * self-contained. The cost is one duplicate `GET /me` at the moment the gate
 * closes on the sign-in branch, once per device, and only for a visitor who
 * actually signed in.
 */
export function Landing({ onEnter }: LandingProps): ReactElement {
  return (
    <SessionProvider>
      <LandingScreen onEnter={onEnter} />
    </SessionProvider>
  );
}

function LandingScreen({ onEnter }: LandingProps): ReactElement {
  const t = useT();
  const { state, signIn } = useSessionValue();

  // The sign-in half of the gate's deliberate asymmetry. The guest button
  // dismisses from its click handler; this branch cannot, because the click
  // navigates to Google and ends the JS context. Dismissing here — after the
  // redirect, once /me has actually answered — is what makes an abandoned or
  // failed OAuth trip return to this screen instead of dropping the visitor
  // into a signed-out app with no way back.
  useEffect(() => {
    if (state.status === 'signedIn') onEnter();
  }, [state.status, onEnter]);

  // `signIn()` writes the session hint BEFORE navigating away, so the boot
  // after the redirect starts in `loading` with the hint present. Without this
  // branch the two buttons flash on screen during every return from Google.
  // `unavailable` is deliberately not pending: it is a resolved answer, and a
  // guest choice has to stay reachable while the Mini is asleep.
  const resolving = state.status === 'loading' && hasSignedInBefore();

  return (
    <main className="bg-canvas flex h-dvh flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-text text-3xl font-semibold tracking-tight">
            {t('landing.wordmark')}
          </h1>
          {/*
            `text-text`, not `text-muted`, and that is a constraint rather than
            a preference: this screen paints on `canvas`, and `muted` on
            `canvas` fails AA in seven of the sixteen light themes (gruvbox-
            light measured 3.80:1). `text` clears 4.5 on canvas in all sixteen.
            Nothing is lost — hierarchy here is size and weight, a 30px
            semibold wordmark against 14px regular, not colour.
            `e2e/contrast.spec.ts` holds the rule; see its RULES comment,
            which also records the one string on this screen still painting
            muted on canvas — the ghost-variant "Continue as guest" button.
          */}
          <p className="text-text text-ui text-balance">{t('landing.tagline')}</p>
        </div>

        {resolving ? (
          // `text-text` for the same reason as the tagline above.
          <p className="text-text text-ui" role="status">
            {t('landing.pending')}
          </p>
        ) : (
          <div className="flex w-full flex-col items-center gap-3">
            <Button variant="default" size="lg" onClick={signIn} className="w-full gap-3">
              <GoogleMark />
              <span>{t('landing.signIn')}</span>
            </Button>
            <Button variant="ghost" size="lg" onClick={onEnter} className="w-full gap-3">
              {t('landing.guest')}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
