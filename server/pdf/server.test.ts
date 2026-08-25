import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createRenderServer, type RenderServerDeps } from './server.ts';
import { RenderTimeoutError } from './render.ts';

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

    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: 'x'.repeat(64 * 1024),
    }).catch((error: Error) => error);

    // Node may destroy the socket before the response is fully read, which
    // surfaces as a fetch rejection rather than a 413. Either is an acceptable
    // refusal; what is NOT acceptable is the renderer being handed the body,
    // or the process dying on a second set of headers.
    if (response instanceof Error) expect(response.message).toBeTruthy();
    else expect(response.status).toBe(413);

    expect(rendered, 'the oversized body must never reach the renderer').toBe(0);

    // Honesty: this line is a smoke check, not a proven control. Removing the
    // `settled` latch and the `req.on('error')` handler was fault-injected and
    // this test still passed — Node does not re-fire `data`/`end` on a
    // destroyed request, so the double-header path could not be provoked. The
    // falsifiable assertion in this test is the one above it: raising the size
    // limit makes `rendered` become 1 and the 413 become a 200.
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('maps a render timeout to 504 and any other failure to 500', async () => {
    const timeoutBase = await start({
      render: async () => {
        throw new RenderTimeoutError();
      },
    });
    expect(
      (await fetch(`${timeoutBase}/render`, { method: 'POST', body: '<p>x</p>' })).status,
    ).toBe(504);

    const failBase = await start({
      render: async () => {
        throw new Error('chromium exploded');
      },
    });
    expect((await fetch(`${failBase}/render`, { method: 'POST', body: '<p>x</p>' })).status).toBe(
      500,
    );
  });
});
