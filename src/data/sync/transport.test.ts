import { describe, expect, it, vi } from 'vitest';

import {
  createTransport,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from './transport';

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transport', () => {
  it('sends credentials on every call', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(200, { notes: [], tags: [], rev: 0 }));
    await createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0);

    // Without this the browser sends no cookie and every call is anonymous —
    // a failure that looks exactly like being signed out.
    expect(doFetch.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('puts `since` in the query string', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(200, { notes: [], tags: [], rev: 9 }));
    await createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(7);

    expect(doFetch.mock.calls[0]![0]).toBe('https://api.test/sync?since=7');
  });

  it('throws SyncUnauthorizedError on 401', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(401, { error: 'not signed in' }));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnauthorizedError);
  });

  it('throws SyncQuotaError carrying the numbers on 413', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(respond(413, { error: 'quota', used: 11, limit: 10 }));

    const error = await createTransport('https://api.test', doFetch as unknown as typeof fetch)
      .push({ notes: [], tags: [] })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SyncQuotaError);
    expect(error).toMatchObject({ used: 11, limit: 10 });
  });

  it('throws SyncUnavailableError when the host cannot be reached', async () => {
    const doFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
  });

  it('throws SyncUnavailableError on a 500, not a silent empty pull', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(500, { error: 'boom' }));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
  });
});

describe('images', () => {
  function transportWith(fetchMock: typeof globalThis.fetch) {
    return createTransport('https://api.test', fetchMock);
  }

  const blob = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

  it('PUTs the bytes with the metadata headers', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await transportWith(doFetch as unknown as typeof globalThis.fetch).uploadImage(
      'f1',
      'n1',
      blob(),
      40,
      20,
    );

    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/files/f1');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-note-id']).toBe('n1');
    expect((init.headers as Record<string, string>)['x-width']).toBe('40');
    // The session cookie is what authorises this; without it every upload 401s.
    expect(init.credentials).toBe('include');
  });

  it('throws SyncQuotaError on a 413, so the caller can leave the file local', async () => {
    const doFetch = vi.fn(
      async () => new Response(JSON.stringify({ used: 5, limit: 4 }), { status: 413 }),
    );

    await expect(
      transportWith(doFetch as unknown as typeof globalThis.fetch).uploadImage(
        'f1',
        'n1',
        blob(),
        1,
        1,
      ),
    ).rejects.toBeInstanceOf(SyncQuotaError);
  });

  it('throws SyncUnauthorizedError on a 401', async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      transportWith(doFetch as unknown as typeof globalThis.fetch).uploadImage(
        'f1',
        'n1',
        blob(),
        1,
        1,
      ),
    ).rejects.toBeInstanceOf(SyncUnauthorizedError);
  });

  it('returns null for a 404 download, which is a placeholder and not an error', async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 404 }));

    expect(
      await transportWith(doFetch as unknown as typeof globalThis.fetch).downloadImage('f1'),
    ).toBeNull();
  });

  it('throws on a 500 download, which IS an error and may be retried', async () => {
    // The distinction matters in both directions: a 404 must not be retried on
    // every render, and a 500 must not be remembered as "this image does not
    // exist".
    const doFetch = vi.fn(async () => new Response(null, { status: 500 }));

    await expect(
      transportWith(doFetch as unknown as typeof globalThis.fetch).downloadImage('f1'),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
  });

  it('returns the bytes on success', async () => {
    const doFetch = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));

    const result = await transportWith(doFetch as unknown as typeof globalThis.fetch).downloadImage(
      'f1',
    );

    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });
});
