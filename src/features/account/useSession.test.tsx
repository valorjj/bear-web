import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAccount } from './api';
import { PENDING_LOGOUT_KEY, SESSION_HINT_KEY, useSession } from './useSession';

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init)),
  );
}

beforeEach(() => {
  localStorage.clear();
  // Almost every test here is a RETURNING user: the boot `/me` call is gated on
  // this hint, so without it the hook resolves to `signedOut` and never asks
  // the server anything. The guest case sets no hint and asserts exactly that.
  localStorage.setItem(SESSION_HINT_KEY, '1');
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

  // StrictMode double-invokes every effect once in dev: mount, clean up,
  // remount, to prove effects tolerate it. A cleanup-only effect that never
  // re-armed its guard on the phantom remount left `mountedRef.current`
  // permanently false, so the session fetch's `setState` was silently
  // skipped and the hook never left `loading` under `npm run dev`. This
  // wraps the hook in a real `StrictMode` to reproduce that phantom
  // mount/unmount/remount and asserts the hook still resolves.
  it('still resolves out of loading after a StrictMode phantom remount', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
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

  it('a failed logout records a pending marker, and the next mount retries it before trusting /me', async () => {
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

    // The revocation is retried, and `/me` is never consulted with the old
    // cookie still live — a signed-in answer there is the exact leak the
    // marker exists to close. (Sign-out also cleared the hint, so once the
    // owed logout succeeds there is nothing left to resolve.)
    expect(order.some((url) => url.endsWith('/auth/logout'))).toBe(true);
    expect(order.some((url) => url.endsWith('/me'))).toBe(false);
    expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBeNull();
  });

  it('makes no request at all when this browser has never signed in', async () => {
    // The gate. `AccountMenu` lives in the shell, so before this hint existed
    // every visitor's boot fired a cross-origin `/me` — a permanent console
    // error offline, and a red `e2e/smoke.spec.ts`.
    localStorage.removeItem(SESSION_HINT_KEY);
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession());

    // Resolved, not stuck in `loading`: the menu must still offer sign-in.
    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('a refused logout (403) records the marker, and the next mount retries it', async () => {
    // A 403 from the origin guard or a 429 from the rate limiter is as much a
    // failure to revoke as an unreachable host: the session row and the cookie
    // both still live. `postLogout` swallowed every non-OK response once, so
    // logout resolved happily, no marker was written, and the next `/me` signed
    // the user straight back in.
    mockFetch((url) =>
      url.endsWith('/me')
        ? new Response(JSON.stringify({ userId: 'u1', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('forbidden', { status: 403 }),
    );

    const first = renderHook(() => useSession());
    await waitFor(() => expect(first.result.current.state.status).toBe('signedIn'));

    await act(async () => {
      await first.result.current.signOut();
    });

    expect(first.result.current.state.status).toBe('signedOut');
    expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBe('1');
    first.unmount();

    // The marker outranks the hint: an owed revocation is retried even though
    // sign-out cleared the "has signed in before" hint.
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();

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

    expect(order.some((url) => url.endsWith('/auth/logout'))).toBe(true);
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

  it('signIn clears a pending revocation marker, so a fresh sign-in is not signed back out', async () => {
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    });

    try {
      // Sign in, then fail a logout so the marker is written.
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
      expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBe('1');

      // The user starts a new sign-in: the marker must clear before the
      // full-page navigation, since nothing after it reliably runs.
      act(() => {
        first.result.current.signIn();
      });
      expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBeNull();
      // And the hint is (re-)armed, so the mount after the redirect back from
      // the provider actually consults `/me`.
      expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
      first.unmount();

      // A follow-up mount, as if the OAuth redirect completed, must not
      // retry a stale logout against the brand-new session.
      const order: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = String(input);
          order.push(url);
          if (url.endsWith('/auth/logout')) return new Response('{}', { status: 200 });
          return new Response(JSON.stringify({ userId: 'u2', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }),
      );

      const second = renderHook(() => useSession());
      await waitFor(() => expect(second.result.current.state.status).toBe('signedIn'));
      expect(order.some((url) => url.endsWith('/auth/logout'))).toBe(false);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
