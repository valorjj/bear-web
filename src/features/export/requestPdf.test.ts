import { describe, expect, it, vi } from 'vitest';

import { PdfExportError, requestPdf } from './requestPdf';

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe('requestPdf', () => {
  it('POSTs the html with credentials and returns the bytes', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(pdfBytes, { status: 200 }),
    );
    const blob = await requestPdf('<p>x</p>', { fetch: fetch as never });

    // Duck-typed: vitest.setup.ts swaps the global Blob for Node's, so
    // `instanceof Blob` is false under test and true in a browser.
    expect(typeof blob.arrayBuffer).toBe('function');

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/export\/pdf$/);
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBe('<p>x</p>');
  });

  it.each([
    [401, 'unauthorized'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    // 500 is the generic "anything else" default, exercised via the
    // `?? 'failed'` fallback rather than an entry in BY_STATUS.
    [500, 'failed'],
    // 502 is the route's own code for "the renderer answered with something
    // broken" (server/src/routes/export.ts) — a genuine failure, distinct
    // from the 503/504 "try again shortly" cases, so it must NOT collapse
    // into 'unavailable'.
    [502, 'failed'],
  ])('maps %i to %s', async (status, reason) => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status }),
    );
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toMatchObject({
      reason,
    });
  });

  it('maps a thrown fetch to offline, not to a generic failure', async () => {
    // The user with no connectivity needs a different sentence from the user
    // whose server is broken; a single "export failed" hides which it is.
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      throw new TypeError('Failed to fetch');
    });
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toMatchObject({
      reason: 'offline',
    });
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toBeInstanceOf(
      PdfExportError,
    );
  });
});
