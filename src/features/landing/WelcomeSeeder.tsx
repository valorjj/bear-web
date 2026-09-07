import { useEffect, useRef } from 'react';

import { notes } from '@/data';
import { useSessionValue, useSyncValue } from '@/features/account';
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
 * **`settled` names the three session statuses explicitly, and must not be
 * rewritten as a negation of `signedIn`.** It was `!signedIn || (…)` until
 * 2026-09-07, and that shipped a bug the whole gate exists to prevent:
 * `useSession` starts EVERY boot at `loading`, so `!signedIn` was true on the
 * very first commit, the effect fired, `ran.current` latched, and the seed ran
 * before `/me` had answered. The signed-in half of the condition was
 * unreachable in production. Each branch below is deliberate:
 *
 *   - `signedOut` seeds immediately. A guest has no session hint, so
 *     `useSession` resolves `signedOut` in a microtask with no fetch at all
 *     (`useSession.ts`) — the seed lands one tick later than it used to, and
 *     the guest path is otherwise unchanged.
 *   - `loading` must NOT seed. Nothing is known yet about whether an
 *     account's notes are about to arrive; that was the bug.
 *   - `unavailable` must NOT seed. It can only be reached when a session hint
 *     was present, i.e. this browser HAS signed in before, so an account's
 *     notes may well exist and be unreachable rather than absent. Seeding here
 *     is how a second device ends up with a duplicate welcome note.
 *
 * There is deliberately no `useLiveQuery` here. `docs/rulings/notes-lifecycle.md`
 * warns about writes gated on a live query, and this is a write; the note
 * count is read once, imperatively, inside `seedWelcomeNote`.
 */
export function WelcomeSeeder(): null {
  const { state } = useSessionValue();
  const sync = useSyncValue();
  const { locale } = useLocale();
  const ran = useRef(false);

  const settled =
    state.status === 'signedOut' ||
    (state.status === 'signedIn' && sync.status === 'idle' && sync.lastSyncedAt !== null);

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
