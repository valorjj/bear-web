import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/data';
import { I18nProvider } from '@/i18n';

import { SessionProvider } from './SessionContext';
import { SyncProvider, useSyncValue } from './SyncContext';
import { SESSION_HINT_KEY } from './useSession';

const syncOnce = vi.fn();

vi.mock('@/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data')>()),
  createEngine: () => ({ syncOnce }),
}));

function Probe(): ReactElement {
  return <span data-testid="status">{useSyncValue().status}</span>;
}

/** A signed-in session with no network of its own: the hint plus a stubbed `/me`. */
function signIn(): void {
  localStorage.setItem(SESSION_HINT_KEY, '1');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

/** Renders the three always-mounted consumers the real app renders. */
function renderApp(): void {
  render(
    <I18nProvider>
      <SessionProvider>
        <SyncProvider>
          <Probe />
          <Probe />
          <Probe />
        </SyncProvider>
      </SessionProvider>
    </I18nProvider>,
  );
}

describe('SyncContext', () => {
  beforeEach(async () => {
    syncOnce.mockReset().mockResolvedValue({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 });
    localStorage.clear();
    await db.notes.clear();
    await db.tags.clear();
    await db.settings.clear();
    // Not this account's first sync, so `runSync` skips the adoption branch
    // and reaches `syncOnce` — which is what these tests count.
    await db.settings.put({ key: 'sync:accountId', value: 'u1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('runs ONE sync on mount however many consumers read it', async () => {
    // The bug this provider exists to prevent. `useSync` holds its
    // concurrency guard in a ref, so three callers were three engines with
    // three guards that could not see each other: three pushes carrying the
    // same `baseRev`, the server accepting the first and conflicting the
    // other two, and a `(conflict)` copy of half-typed text minted on a
    // single device with no second actor anywhere.
    signIn();
    renderApp();

    await waitFor(() => expect(screen.getAllByTestId('status')).toHaveLength(3));
    await waitFor(() => expect(syncOnce.mock.calls.length).toBeGreaterThan(0));
    // Settle anything the mount could still have scheduled before counting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(syncOnce.mock.calls.length).toBe(1);
  });

  it('runs ONE sync per local write, not one per consumer', async () => {
    // The trigger that actually fired in production: `useSync` subscribes to
    // Dexie's own `notes` hooks, so each instance held its own debounce timer
    // and one autosave scheduled a run on every one of them.
    signIn();
    renderApp();
    await waitFor(() => expect(syncOnce.mock.calls.length).toBeGreaterThan(0));
    syncOnce.mockClear();

    // A real Dexie write, so the hooks fire exactly as they do in the app.
    await db.notes.add({
      id: 'n1',
      title: 'TEST3',
      text: 'TEST3\n#a/b',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    // Past `EDIT_DEBOUNCE_MS`, with room for the run itself.
    await new Promise((resolve) => setTimeout(resolve, 2400));

    expect(syncOnce.mock.calls.length).toBe(1);
  }, 8000);

  it('throws outside a provider rather than yielding a silent default', () => {
    // A default controller would render "idle, never synced" forever, which
    // reads as a product decision instead of the wiring bug it is — and
    // `WelcomeSeeder` gates the welcome note on exactly those two values.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/SyncProvider/);
    quiet.mockRestore();
  });
});
