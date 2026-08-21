import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAccount } from './api';
import { PENDING_LOGOUT_KEY, useSession } from './useSession';

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init)),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useSession', () => {
  it('starts loading and never blocks the caller', () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession());

    // The first render must return synchronously with no awaited network call:
    // the app's boot guarantee is that nothing here can delay paint.
    expect(result.current.state.status).toBe('loading');
  });

  it('resolves to signedIn with the account', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
    expect(result.current.state).toEqual({
      status: 'signedIn',
      account: { userId: 'u1', email: 'a@example.com' },
    });
  });

  it('resolves to signedOut on 401', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
  });

  it('resolves to unavailable when the server cannot be reached', async () => {
    // The normal state for a machine that sleeps. It must be distinct from
    // signedOut, because telling a signed-in user they are signed out whenever
    // the Mini naps is a lie the UI would then repeat.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('sends credentials on every call', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    renderHook(() => useSession());

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('returns to signedOut after signOut', async () => {
    mockFetch((url) =>
      url.endsWith('/me')
        ? new Response(JSON.stringify({ userId: 'u1', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 200 }),
    );

    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.state.status).toBe('signedOut');
  });

  it('a failed logout records a pending marker, and the next mount retries logout before /me', async () => {
    // Sign in, then sign out while the server is unreachable.
    mockFetch((url) =>
      url.endsWith('/me')
        ? new Response(JSON.stringify({ userId: 'u1', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 200 }),
    );
    const first = renderHook(() => useSession());
    await waitFor(() => expect(first.result.current.state.status).toBe('signedIn'));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).endsWith('/auth/logout')) throw new TypeError('Failed to fetch');
        return new Response('{}', { status: 200 });
      }),
    );
    await act(async () => {
      await first.result.current.signOut();
    });

    expect(first.result.current.state.status).toBe('signedOut');
    expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBe('1');
    first.unmount();

    // Remount with the server now reachable: logout must be retried before
    // /me is ever consulted, and the marker must clear on success.
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        order.push(url);
        if (url.endsWith('/auth/logout')) return new Response('{}', { status: 200 });
        return new Response('{}', { status: 401 });
      }),
    );

    const second = renderHook(() => useSession());
    await waitFor(() => expect(second.result.current.state.status).toBe('signedOut'));

    const logoutIndex = order.findIndex((url) => url.endsWith('/auth/logout'));
    const meIndex = order.findIndex((url) => url.endsWith('/me'));
    expect(logoutIndex).toBeGreaterThanOrEqual(0);
    expect(meIndex).toBeGreaterThan(logoutIndex);
    expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBeNull();
  });

  it('a successful logout leaves no pending marker behind', async () => {
    mockFetch((url) =>
      url.endsWith('/me')
        ? new Response(JSON.stringify({ userId: 'u1', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 200 }),
    );

    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.state.status).toBe('signedOut');
    expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBeNull();
  });

  it('resolves to a sensible state even when localStorage throws on read', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    try {
      mockFetch(() => new Response('{}', { status: 401 }));

      const { result } = renderHook(() => useSession());

      await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it('a non-OK, non-401 response carries its status in the error message', async () => {
    mockFetch(() => new Response('{}', { status: 500 }));

    await expect(fetchAccount()).rejects.toThrow(/500/);
  });
});
