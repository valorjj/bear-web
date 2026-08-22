import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('useSync', () => {
  beforeEach(() => {
    syncOnce.mockReset().mockResolvedValue({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 });
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
});
