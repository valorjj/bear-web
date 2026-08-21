import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSession } from './useSession';

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
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
});
