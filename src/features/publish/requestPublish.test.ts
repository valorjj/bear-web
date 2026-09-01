import { describe, it, expect, vi } from 'vitest';
import { API_ORIGIN } from '@/data/sync/config';
import { publishNote, unpublishNote, listPublished } from './requestPublish';

describe('publishNote', () => {
  it('posts the document with the note id and title', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: 'abc', url: 'u', publishedAt: 1 }, { status: 201 }),
    );
    await publishNote('<p>hi</p>', 'note-1', '자산화 노트', { fetch: fetch as never });

    const [url, init] = fetch.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(`${API_ORIGIN}/publish`);
    // Encoded, not concatenated: titles are frequently Korean and may contain &.
    expect(parsed.searchParams.get('noteId')).toBe('note-1');
    expect(parsed.searchParams.get('title')).toBe('자산화 노트');
    expect((init as RequestInit).credentials).toBe('include');
    expect(String((init as RequestInit).body)).toBe('<p>hi</p>');
  });

  it('maps a thrown fetch to offline', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      throw new TypeError('Failed to fetch');
    });
    await expect(publishNote('<p/>', 'n', 'T', { fetch: fetch as never })).rejects.toMatchObject({
      reason: 'offline',
    });
  });

  it.each([
    [401, 'unauthorized'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [500, 'failed'],
  ])('maps %i to %s', async (status, reason) => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response('', { status }),
    );
    await expect(publishNote('<p/>', 'n', 'T', { fetch: fetch as never })).rejects.toMatchObject({
      reason,
    });
  });

  it('carries the limit out of a 403 so the message can name it', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ error: 'quota', limit: 50 }, { status: 403 }),
    );
    await expect(publishNote('<p/>', 'n', 'T', { fetch: fetch as never })).rejects.toMatchObject({
      reason: 'quotaExceeded',
      limit: 50,
    });
  });

  it('survives a 403 with an unreadable body', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('not json', { status: 403 }),
    );
    await expect(publishNote('<p/>', 'n', 'T', { fetch: fetch as never })).rejects.toMatchObject({
      reason: 'quotaExceeded',
    });
  });
});

describe('unpublishNote', () => {
  it('unpublishes by id', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    await unpublishNote('abc', { fetch: fetch as never });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${API_ORIGIN}/publish/abc`);
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('listPublished', () => {
  it('lists published pages', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ pages: [{ id: 'a', noteId: 'n', title: 'T', bytes: 1, publishedAt: 2 }] }),
    );
    expect(await listPublished({ fetch: fetch as never })).toEqual([
      { id: 'a', noteId: 'n', title: 'T', bytes: 1, publishedAt: 2 },
    ]);
  });
});
