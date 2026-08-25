import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueueFullError } from './queue.ts';
import { RenderTimeoutError } from './render.ts';
import { createRenderServer, type RenderServerDeps } from './server.ts';

const servers: ReturnType<typeof createRenderServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((r) => server.close(() => r()))),
  );
});

async function start(deps: RenderServerDeps): Promise<string> {
  const server = createRenderServer(deps);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // '%PDF-'

const HTML = { 'content-type': 'text/html' };

function post(base: string, body = '<p>x</p>', headers: Record<string, string> = HTML) {
  return fetch(`${base}/render`, { method: 'POST', headers, body });
}

describe('createRenderServer', () => {
  it('answers /health', async () => {
    const base = await start({ render: async () => pdfBytes });
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('renders a POST to /render as application/pdf', async () => {
    let seen = '';
    const base = await start({
      render: async (html) => {
        seen = html;
        return pdfBytes;
      },
    });

    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: '<h1>안녕</h1>',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    // Duck-typed, not `instanceof ArrayBuffer` — the global is swapped under
    // Vitest and the check would be false for a real buffer.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).toString()).toBe('%PDF-');
    // Round-trips as UTF-8, not latin1: a note is mostly Korean.
    expect(seen).toBe('<h1>안녕</h1>');
  });

  it('rejects anything but POST /render and GET /health', async () => {
    const base = await start({ render: async () => pdfBytes });

    expect((await fetch(`${base}/render`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });

  it('refuses an oversized body with 413 and stays up', async () => {
    let rendered = 0;
    const base = await start({
      maxBytes: 1024,
      render: async () => {
        rendered += 1;
        return pdfBytes;
      },
    });

    // Just over the limit, and small enough to arrive in ONE chunk, so the
    // response is written and flushed before the socket is destroyed. An
    // earlier version sent 64KB, which raced the destroy and could surface as
    // a fetch rejection instead of a status — so it accepted either, and the
    // status half asserted nothing.
    const response = await post(base, 'x'.repeat(1100));

    expect(response.status).toBe(413);
    expect(rendered, 'the oversized body must never reach the renderer').toBe(0);

    // Honesty: this line is a smoke check, not a proven control. Removing the
    // `settled` latch and the `req.on('error')` handler was fault-injected and
    // this test still passed — Node does not re-fire `data`/`end` on a
    // destroyed request, so the double-header path could not be provoked. The
    // falsifiable assertions are the two above.
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('maps a render timeout to 504 and any other failure to 500', async () => {
    const timeoutBase = await start({
      render: async () => {
        throw new RenderTimeoutError();
      },
    });
    expect((await post(timeoutBase)).status).toBe(504);

    const failBase = await start({
      render: async () => {
        throw new Error('chromium exploded');
      },
    });
    expect((await post(failBase)).status).toBe(500);
  });

  it('requires content-type: text/html, so a cross-origin page cannot reach it', async () => {
    // `text/html` is not CORS-safelisted, so requiring it forces a preflight
    // that this server never answers. Attempted with each content-type a
    // simple cross-origin POST CAN set without one.
    let rendered = 0;
    const base = await start({
      render: async () => {
        rendered += 1;
        return pdfBytes;
      },
    });

    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/json',
    ]) {
      expect((await post(base, '<p>x</p>', { 'content-type': type })).status, type).toBe(415);
    }

    // A missing header is refused too, and the real one still works — with the
    // charset a fetch appends, which a naive equality check would reject.
    expect((await fetch(`${base}/render`, { method: 'POST', body: '<p>x</p>' })).status).toBe(415);
    expect(rendered, 'no refused request may reach the renderer').toBe(0);

    expect(
      (await post(base, '<p>x</p>', { 'content-type': 'text/html; charset=utf-8' })).status,
    ).toBe(200);
  });

  it('sheds with 503 past the in-flight limit instead of buffering every body', async () => {
    const release: (() => void)[] = [];
    const base = await start({
      maxInflight: 2,
      render: () =>
        new Promise<Uint8Array>((resolve) => {
          release.push(() => resolve(pdfBytes));
        }),
    });

    const held = [post(base), post(base)];
    // Both must be admitted and parked in `render` before the third arrives,
    // or this asserts nothing about the limit.
    await vi.waitFor(() => expect(release.length).toBe(2));

    expect((await post(base)).status).toBe(503);

    for (const resolve of release) resolve();
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200]);

    // The slot is returned, not leaked: a fourth request now succeeds.
    expect(release.length).toBe(2);
    const after = post(base);
    await vi.waitFor(() => expect(release.length).toBe(3));
    release[2]!();
    expect((await after).status).toBe(200);
  });

  it('maps a full render queue to 503', async () => {
    const base = await start({
      render: async () => {
        throw new QueueFullError();
      },
    });

    expect((await post(base)).status).toBe(503);
  });
});
