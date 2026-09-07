import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_HINT_KEY } from '@/data';
import { SessionProvider, SyncProvider } from '@/features/account';
import { I18nProvider } from '@/i18n';

import { LANDING_SEEN_KEY } from './gate';
import { WelcomeSeeder } from './WelcomeSeeder';

/**
 * The seed gate against the REAL boot sequence.
 *
 * `WelcomeSeeder.test.tsx` mocks `@/features/account` and injects a session
 * that is `signedIn` from render 0 — a state the real app never starts in,
 * which is exactly why the `!signedIn || (…)` bug survived every one of those
 * tests: `useSession` begins EVERY boot at `loading`, `!signedIn` was true on
 * the first commit, and the seed ran before `/me` had answered. Those tests
 * cover the decision table; this file covers the sequence, using the real
 * `SessionProvider` and a real (stubbed) `fetch`.
 *
 * The real `SyncProvider` too, deliberately: `WelcomeSeeder` reads its
 * `lastSyncedAt` and no case below ever ends signed in (401, a throwing
 * fetch, no hint at all), so the provider's `useSync` never reaches an
 * account id and never syncs anything. Mocking it here would remove the one
 * thing this file exists to exercise — the real wiring.
 */

const seed = vi.fn(async (..._args: unknown[]) => true);
vi.mock('./seedWelcomeNote', () => ({ seedWelcomeNote: (...args: unknown[]) => seed(...args) }));

function mount() {
  return render(
    <I18nProvider>
      <SessionProvider>
        <SyncProvider>
          <WelcomeSeeder />
        </SyncProvider>
      </SessionProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANDING_SEEN_KEY, '1');
  seed.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('WelcomeSeeder, against the real session boot', () => {
  // The regression. A returning browser carries the session hint, so `/me` is
  // consulted and the session sits in `loading` until it answers. Seeding in
  // that window is how a second device gets a duplicate welcome note: the
  // local database is empty only because the account's notes have not
  // arrived yet.
  it('does NOT seed while /me is still in flight', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    mount();

    await new Promise((r) => setTimeout(r, 20));
    expect(seed).not.toHaveBeenCalled();
  });

  // Falsifies the test above: the same harness DOES reach the seed once the
  // session resolves, so "not called" there is about the loading window and
  // not about a provider that never lets anything through.
  it('seeds once /me answers that nobody is signed in', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    mount();

    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
  });

  // `unavailable` is only reachable with a hint present, i.e. this browser has
  // signed in before, so an account's notes may exist and simply be
  // unreachable. Absence of notes here is not evidence of an empty account.
  it('does NOT seed when /me is unreachable', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );

    mount();

    await new Promise((r) => setTimeout(r, 20));
    expect(seed).not.toHaveBeenCalled();
  });

  // The guest path, end to end: no hint means no fetch at all, so the session
  // resolves `signedOut` in a microtask and the seed lands one tick later
  // than the buggy version's synchronous first commit.
  it('seeds for a guest with no session hint, without any fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);

    mount();

    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
