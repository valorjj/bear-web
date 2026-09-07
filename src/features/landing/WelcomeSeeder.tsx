import { useEffect, useRef } from 'react';

import { notes } from '@/data';
import { useSessionValue, useSync } from '@/features/account';
import { useLocale } from '@/i18n';

import { seedWelcomeNote } from './seedWelcomeNote';

/**
 * Runs the welcome-note seed at the one moment it is safe to.
 *
 * Renders nothing. It lives inside `AppShell`'s `SessionProvider` rather than
 * inside `Landing` because the sign-in branch cannot seed from the landing
 * screen at all: that click navigates to Google and ends the JS context, so
 * the seed necessarily happens on the boot AFTER the redirect, by which time
 * `Landing` has unmounted and `AppShell` is mounted instead.
 *
 * **"Settled" is `lastSyncedAt`, not an idle-after-syncing transition.** A
 * sync that completes before this component mounts never shows a `syncing`
 * status here, and a transition-based rule would then miss the seed on every
 * boot, forever, for exactly the accounts that sync fastest.
 *
 * A signed-in device whose server is unreachable never settles, so nothing is
 * seeded and the device flag stays unset — a later boot tries again. That is
 * deliberate: seeding against an unreachable server would inject a note that
 * duplicates the moment the server answers.
 *
 * There is deliberately no `useLiveQuery` here. `docs/rulings/notes-lifecycle.md`
 * warns about writes gated on a live query, and this is a write; the note
 * count is read once, imperatively, inside `seedWelcomeNote`.
 */
export function WelcomeSeeder(): null {
  const { state } = useSessionValue();
  const sync = useSync(state);
  const { locale } = useLocale();
  const ran = useRef(false);

  const signedIn = state.status === 'signedIn';
  const settled = !signedIn || (sync.status === 'idle' && sync.lastSyncedAt !== null);

  useEffect(() => {
    if (ran.current || !settled) return;
    ran.current = true;
    void seedWelcomeNote({
      listActive: () => notes.listActive(),
      create: (text) => notes.create(text),
      locale,
    });
  }, [settled, locale]);

  return null;
}
