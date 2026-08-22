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
