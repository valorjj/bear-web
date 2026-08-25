import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.ts';
import { MAX_EXPORT_BYTES } from './export.ts';
import { signedInDeps, withOrigin, withSessionCookie } from './testSupport.ts';

const HTML = '<html><body>hi</body></html>';

function pdfFetch(status = 200, body: Uint8Array = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(body, { status, headers: { 'content-type': 'application/pdf' } });
  });
}

describe('POST /export/pdf', () => {
  it('rejects an unauthenticated caller', async () => {
    const app = createApp(await signedInDeps({ authenticated: false }));
    // withOrigin, not a bare request: without an Origin header a POST is
    // rejected by originGuard (403) before authentication ever runs, which
    // would make this test pass for the wrong reason.
    const res = await app.request('/export/pdf', withOrigin({ method: 'POST', body: HTML }));
    expect(res.status).toBe(401);
  });

  it('returns the renderer output as application/pdf', async () => {
    const renderer = pdfFetch();
    const deps = await signedInDeps({ rendererFetch: renderer });
    const app = createApp(deps);
    const res = await app.request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    );

    // The renderer requires text/html and 415s anything else (Task 3's
    // decision) — verify the forwarder actually complies rather than
    // trusting that a 200 implies it did.
    expect(renderer).toHaveBeenCalledTimes(1);
    const [, init] = renderer.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('content-type')).toBe('text/html');
  });

  it('rejects a body over the cap WITHOUT calling the renderer', async () => {
    // Order matters: a cap enforced after the forward is not a cap.
    const renderer = pdfFetch();
    const deps = await signedInDeps({ rendererFetch: renderer });
    const app = createApp(deps);
    const res = await app.request(
      '/export/pdf',
      withSessionCookie({ method: 'POST', body: 'x'.repeat(MAX_EXPORT_BYTES + 1) }),
    );

    expect(res.status).toBe(413);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('answers 503 when the renderer cannot be reached', async () => {
    const deps = await signedInDeps({
      rendererFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const app = createApp(deps);
    const res = await app.request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(503);
  });

  it('passes the renderer own 503 (load-shed) through as 503', async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch(503, new Uint8Array()) });
    const app = createApp(deps);
    const res = await app.request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(503);
  });

  it('passes a renderer timeout through as 504', async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch(504, new Uint8Array()) });
    const app = createApp(deps);
    const res = await app.request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(504);
  });

  it('answers 502 when the renderer returns a broken response', async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch(500, new Uint8Array()) });
    const app = createApp(deps);
    const res = await app.request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(502);
  });

  it("enforces its own rate limit, tighter than /sync's 120/min", async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch() });
    const app = createApp(deps);

    let lastStatus = 200;
    for (let i = 0; i < 11; i += 1) {
      const res = await app.request(
        '/export/pdf',
        withSessionCookie({ method: 'POST', body: HTML }),
      );
      lastStatus = res.status;
    }
    // The limit is 10/min; the 11th request in the same window must be throttled.
    expect(lastStatus).toBe(429);
  });
});
