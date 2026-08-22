import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from '@/data';
import { I18nProvider } from '@/i18n';

import type { SessionState } from './useSession';
import { useSync } from './useSync';

const syncOnce = vi.fn();

vi.mock('@/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data')>()),
  createEngine: () => ({ syncOnce }),
}));

const signedIn: SessionState = {
  status: 'signedIn',
  account: { userId: 'u1', email: 'a@example.com' },
};

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

async function addLocalNote(id: string): Promise<void> {
  await db.notes.add({
    id,
    title: id,
    text: id,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  });
}

describe('useSync', () => {
  beforeEach(() => {
    syncOnce.mockReset().mockResolvedValue({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 });
  });

  afterEach(async () => {
    // Each adoption test writes real rows to the real (fake-indexeddb) `db`,
    // since only `createEngine` is mocked above — a leftover note or setting
    // would make the NEXT test's "first sync" no longer look like one.
    await db.notes.clear();
    await db.tags.clear();
    await db.settings.clear();
  });

  it('does not sync when signed out', async () => {
    renderHook(() => useSync({ status: 'signedOut' }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncOnce).not.toHaveBeenCalled();
  });

  it('syncs on mount when signed in', async () => {
    renderHook(() => useSync(signedIn), { wrapper });
    await waitFor(() => expect(syncOnce).toHaveBeenCalledWith('u1'));
  });

  it('reports offline rather than error when the server is unreachable', async () => {
    const { SyncUnavailableError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncUnavailableError('nope'));

    const { result } = renderHook(() => useSync(signedIn), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('offline'));
    // A machine that sleeps is offline constantly. Calling that an error would
    // make the one real error state meaningless.
    expect(result.current.message).toBeNull();
  });

  it('reports a quota overrun as an error with a plain message', async () => {
    const { SyncQuotaError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncQuotaError(11, 10));

    const { result } = renderHook(() => useSync(signedIn), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe(
      'Your account is full. Delete some notes to back up again.',
    );
  });

  it('stops syncing after a 401 rather than hammering the server', async () => {
    const { SyncUnauthorizedError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncUnauthorizedError('gone'));

    const { result } = renderHook(() => useSync(signedIn), { wrapper });
    await waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));

    act(() => result.current.syncNow());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  it('never runs two syncs at once', async () => {
    let release: () => void = () => {};
    syncOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 });
        }),
    );

    const { result } = renderHook(() => useSync(signedIn), { wrapper });
    await waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));

    act(() => result.current.syncNow());
    act(() => result.current.syncNow());
    expect(syncOnce).toHaveBeenCalledTimes(1);

    act(() => release());
  });

  describe('adoption', () => {
    it('does not block sync when there are zero local notes', async () => {
      const { result } = renderHook(() => useSync(signedIn), { wrapper });

      await waitFor(() => expect(syncOnce).toHaveBeenCalledWith('u1'));
      expect(result.current.adoption).toBeNull();
    });

    it('blocks the first sync when a guest has tag metadata but no notes', async () => {
      // Tags are local data too. Gating on notes alone means `markAllDirty`
      // never runs for this user and their tag rows — order, icon, collapsed
      // — are never pushed at all.
      await db.tags.add({ tag: 'work', collapsed: true, iconKey: 'house', sortOrder: 1 });

      const { result } = renderHook(() => useSync(signedIn), { wrapper });

      await waitFor(() => expect(result.current.adoption).not.toBeNull());
      expect(syncOnce).not.toHaveBeenCalled();
    });

    it('blocks the first sync into a NEW account when local notes exist', async () => {
      await addLocalNote('n1');
      await addLocalNote('n2');

      const { result } = renderHook(() => useSync(signedIn), { wrapper });

      await waitFor(() => expect(result.current.adoption).toEqual({ count: 2 }));
      // Blocked, not merely pending: the mount trigger already fired and
      // must not have reached `syncOnce` before the user answers.
      expect(syncOnce).not.toHaveBeenCalled();
    });

    // This is the finding Task 7's review raised and Task 9 owns: a device
    // that last synced account A, then signs into account B, must not push
    // A's leftover notes into B silently. The dialog fires on exactly the
    // condition this test sets up — `SYNCED_ACCOUNT_KEY` names a DIFFERENT
    // account than the one now signed in, with local notes still present.
    it('blocks the first sync after an ACCOUNT SWITCH, not only a first-ever sign-in', async () => {
      await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: 'previous-account' });
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 42 });
      await addLocalNote('leftover-from-a');

      const { result } = renderHook(() => useSync(signedIn), { wrapper });

      await waitFor(() => expect(result.current.adoption).toEqual({ count: 1 }));
      expect(syncOnce).not.toHaveBeenCalled();
    });

    it('"Add them" marks notes dirty, records the account, then syncs', async () => {
      await addLocalNote('n1');

      const { result } = renderHook(() => useSync(signedIn), { wrapper });
      await waitFor(() => expect(result.current.adoption).not.toBeNull());

      act(() => result.current.onAdopt());

      await waitFor(() => expect(syncOnce).toHaveBeenCalledWith('u1'));
      expect(result.current.adoption).toBeNull();

      const note = await db.notes.get('n1');
      expect(note).toBeDefined();
      const state = await db.syncState.get(['note', 'n1']);
      expect(state?.dirty).toBe(1);
      const account = await db.settings.get(SYNCED_ACCOUNT_KEY);
      expect(account?.value).toBe('u1');
    });

    it('"Discard them" purges local notes through the notes repository, then syncs', async () => {
      await addLocalNote('n1');

      const { result } = renderHook(() => useSync(signedIn), { wrapper });
      await waitFor(() => expect(result.current.adoption).not.toBeNull());

      act(() => result.current.onDiscard());

      await waitFor(() => expect(syncOnce).toHaveBeenCalledWith('u1'));
      expect(result.current.adoption).toBeNull();
      expect(await db.notes.get('n1')).toBeUndefined();
      // A note this device never synced has nothing to tell the server to
      // delete, so `markDeleted` drops the bookkeeping row rather than
      // queuing a tombstone push into the freshly-adopted account.
      expect(await db.syncState.get(['note', 'n1'])).toBeUndefined();
    });
  });
});
