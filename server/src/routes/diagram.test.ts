import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { MAX_DIAGRAM_BYTES } from './diagram.ts';
import { APP_ORIGIN, signedInDeps, withOrigin, withSessionCookie } from './testSupport.ts';

const SOURCE = 'flowchart TD\n A --> B';

function rendererFetch(status = 200, body = '<svg id="ok"/>', contentType = 'image/svg+xml') {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(body, { status, headers: { 'content-type': contentType } });
  });
}

describe('POST /diagram', () => {
  it('rejects an unauthenticated caller', async () => {
    const app = createApp(await signedInDeps({ authenticated: false }));
    // withOrigin, not a bare request: without an Origin header a POST is
    // rejected by originGuard (403) before authentication ever runs, which
    // would make this test pass for the wrong reason.
    const res = await app.request(
      '/diagram',
      withOrigin({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('forwards the source and returns the SVG', async () => {
    const renderer = rendererFetch();
    const deps = await signedInDeps({ rendererFetch: renderer });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(await res.text()).toBe('<svg id="ok"/>');

    expect(renderer).toHaveBeenCalledTimes(1);
    const [url, init] = renderer.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8788/render/mermaid');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ source: SOURCE });
  });

  it('rejects a body over the cap WITHOUT calling the renderer', async () => {
    // Order matters: a cap enforced after the forward is not a cap. Fault
    // injection (moving the cap check after the forward) turns this
    // `renderer not called` assertion red, which is the point — the status
    // code alone would not have caught it.
    const renderer = rendererFetch();
    const deps = await signedInDeps({ rendererFetch: renderer });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'x'.repeat(MAX_DIAGRAM_BYTES + 1) }),
      }),
    );

    expect(res.status).toBe(413);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('passes the 422 body through so the parser message reaches the user', async () => {
    const deps = await signedInDeps({
      rendererFetch: rendererFetch(
        422,
        JSON.stringify({ error: 'Parse error on line 2' }),
        'application/json',
      ),
    });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'bad' }),
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Parse error on line 2' });
  });

  it('passes the renderer own 503 (queue full) through as 503', async () => {
    const deps = await signedInDeps({ rendererFetch: rendererFetch(503, '', 'text/plain') });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('passes a renderer timeout through as 504', async () => {
    const deps = await signedInDeps({ rendererFetch: rendererFetch(504, '', 'text/plain') });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(504);
  });

  it('maps any other non-OK renderer status to 502', async () => {
    const deps = await signedInDeps({ rendererFetch: rendererFetch(500, '', 'text/plain') });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(502);
  });

  it('maps an unexpected 418 to 502', async () => {
    const deps = await signedInDeps({ rendererFetch: rendererFetch(418, '', 'text/plain') });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(502);
  });

  it('returns 503 when the renderer is unreachable', async () => {
    const deps = await signedInDeps({
      rendererFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('refuses to pass on markup the guard rejects, and does not leak it', async () => {
    // Defence in depth against a mis-deployed or replaced renderer: the
    // container sanitizes, and this checks again at the boundary. 502,
    // because this is the renderer answering with something broken — and the
    // hostile body must not reach the client even inside a 502.
    const hostile = '<svg><script>alert(1)</script></svg>';
    const deps = await signedInDeps({
      rendererFetch: rendererFetch(200, hostile, 'image/svg+xml'),
    });
    const app = createApp(deps);
    const res = await app.request(
      '/diagram',
      withSessionCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: SOURCE }),
      }),
    );

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain('script');
    expect(body.length).toBe(0);
  });

  it("enforces its own rate limit, between /sync's 120 and /export/*'s 10, keyed per session", async () => {
    // 60/min sits deliberately between the two: a diagram render is cheap
    // (~100ms) and the editor legitimately issues a burst of them while
    // someone iterates on one, so it must not throttle at /export/*'s rate
    // — but it still has to bound abuse, which /sync's session-keyed bucket
    // (not the earlier /export/* precedent's bare status assertion) is
    // exactly what proves: exhausting one session's bucket must not affect
    // a different session's.
    const deps = await signedInDeps({ rendererFetch: rendererFetch() });
    const app = createApp(deps);
    const name = cookieName(SESSION_COOKIE, false);
    const cookieA = `${name}=session-a`;
    const cookieB = `${name}=session-b`;

    let lastStatus = 200;
    for (let i = 0; i < 61; i += 1) {
      const res = await app.request('/diagram', {
        method: 'POST',
        headers: { origin: APP_ORIGIN, 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({ source: SOURCE }),
      });
      lastStatus = res.status;
    }
    // The limit is 60/min; the 61st request in the same window (same
    // session) must be throttled.
    expect(lastStatus).toBe(429);

    // A different session's bucket is untouched by session A's exhaustion —
    // this is what proves the limiter is keyed per session rather than
    // shared globally or per process.
    const otherSession = await app.request('/diagram', {
      method: 'POST',
      headers: { origin: APP_ORIGIN, 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ source: SOURCE }),
    });
    expect(otherSession.status).toBe(200);
  });
});
