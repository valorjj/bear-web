import { describe, expect, it, vi } from 'vitest';

import { API_ORIGIN } from '@/data';

import { requestDiagram } from './requestDiagram';

describe('requestDiagram', () => {
  it('posts JSON to /diagram and returns the SVG', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('<svg/>', { status: 200 }),
    );
    const svg = await requestDiagram('flowchart TD\n A --> B', { fetch });

    expect(svg).toBe('<svg/>');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${API_ORIGIN}/diagram`);
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ source: 'flowchart TD\n A --> B' });
  });

  it('maps a thrown fetch to offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(requestDiagram('x', { fetch })).rejects.toMatchObject({ reason: 'offline' });
  });

  it.each([
    [401, 'unauthorized'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [502, 'failed'],
    [500, 'failed'],
  ])('maps %i to %s', async (status, reason) => {
    const fetch = vi.fn(async () => new Response('', { status }));
    await expect(requestDiagram('x', { fetch })).rejects.toMatchObject({ reason });
  });

  it('carries the parser message out of a 422', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Parse error on line 2' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await expect(requestDiagram('x', { fetch })).rejects.toMatchObject({
      reason: 'invalidSyntax',
      detail: 'Parse error on line 2',
    });
  });

  it('survives a 422 with an unreadable body', async () => {
    // The message is a nicety; the reason is the contract. A malformed error
    // body must not turn a syntax error into an unhandled exception.
    const fetch = vi.fn(async () => new Response('not json', { status: 422 }));

    await expect(requestDiagram('x', { fetch })).rejects.toMatchObject({ reason: 'invalidSyntax' });
  });

  it('refuses an SVG containing a script without asking the DOM', async () => {
    // Fourth check, client side. The container sanitizes with a real DOM
    // walk, the container re-checks with a regex guard, and the API
    // re-checks at the boundary; this is what stands between a replaced or
    // mis-deployed renderer and markup inlined into the user's notes. Cheap,
    // and the only one an attacker cannot reach.
    const fetch = vi.fn(async () => new Response('<svg><script>alert(1)</script></svg>'));

    await expect(requestDiagram('x', { fetch })).rejects.toMatchObject({ reason: 'failed' });
  });
});
