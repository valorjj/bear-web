import type { Page } from '@playwright/test';

/**
 * Where the real containerised renderer is, when one is running.
 *
 * `npm run pdf:up` publishes it on `127.0.0.1:8788`. Absent, the tests that
 * need it skip — they cannot be faked, which is the point of them.
 */
export const RENDERER_URL = process.env.PDF_RENDERER_URL ?? '';

/**
 * The API origin the production build talks to.
 *
 * `import.meta.env.DEV` is false under `vite preview`, so the built app the
 * e2e suite exercises resolves `API_ORIGIN` to the production host — the same
 * value `sync.spec.ts` intercepts.
 */
export const API_ORIGIN = 'https://api.markflowing.com';

export const SESSION_HINT_KEY = 'bear-web:account:hasSession';

/**
 * Marks the seeded notes as already belonging to the signed-in account.
 *
 * Without these, `useSync` raises `AdoptNotesDialog`, whose scrim covers the
 * whole shell — and Playwright reports it as `<div aria-hidden="true" …>
 * intercepts pointer events` on a note-list click, which reads as a layout
 * bug rather than as a modal nobody dismissed. Same reason `sync.spec.ts`
 * seeds them.
 */
export const ADOPTED_SYNC_SETTINGS = [
  { key: 'sync:accountId', value: 'u1' },
  { key: 'sync:lastPulledRev', value: 0 },
];

const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:4173',
  'access-control-allow-credentials': 'true',
  // `text/html` is not a CORS-safelisted request content-type, so the real
  // POST is preflighted. `route.fulfill` does not surface the OPTIONS leg, and
  // Chromium still checks these headers on the fulfilled response — without
  // them the POST is blocked and the export looks like an offline failure.
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * Makes the app believe a session exists, without a real OAuth round trip.
 *
 * `GET /me` is gated on the locally stored hint, so both halves are needed:
 * without the hint the app never asks, and without the route the ask fails.
 */
export async function signIn(page: Page, email = 'pdf@example.com'): Promise<void> {
  await page.route(`${API_ORIGIN}/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ userId: 'u1', email }),
    }),
  );
  await page.route(`${API_ORIGIN}/sync**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ notes: [], tags: [], rev: 0 }),
    }),
  );
  await page.addInitScript((key: string) => {
    localStorage.setItem(key, '1');
  }, SESSION_HINT_KEY);
}

/**
 * Forwards `POST /export/pdf` to the real renderer container.
 *
 * The ONE seam in an otherwise end-to-end path, and it is the authenticated
 * Hono pass-through — which needs a live MariaDB, a real Google session and a
 * cookie a browser will actually send, and which `server/src/routes/*.test.ts`
 * already covers in isolation including its 401, 413, 502, 503 and 504
 * mappings. Everything on either side of the seam is real: the document is
 * the one the app built from the note on screen under the theme the user
 * selected, and the PDF is the one the containerised Chromium produced from
 * it.
 *
 * The body is taken with `postDataBuffer()`, not `postData()`: the export
 * document contains Korean, and the string accessor's decoding is one more
 * thing that could quietly corrupt what the renderer sees.
 */
export async function forwardPdfToRenderer(page: Page, rendererUrl: string): Promise<void> {
  await page.route(`${API_ORIGIN}/export/pdf`, async (route) => {
    const body = route.request().postDataBuffer();

    const upstream = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      // A fresh Uint8Array, not the Buffer itself: this project's `e2e`
      // tsconfig includes the DOM lib, so `fetch` here is typed against
      // `BodyInit`, which does not accept Node's `Buffer<ArrayBufferLike>`.
      body: new Uint8Array(body ?? []),
    });

    await route.fulfill({
      status: upstream.status,
      contentType: 'application/pdf',
      headers: corsHeaders,
      body: Buffer.from(await upstream.arrayBuffer()),
    });
  });
}

/**
 * Forwards `POST /diagram` to the real renderer container's
 * `/render/mermaid` endpoint, mirroring `forwardPdfToRenderer` above and the
 * authenticated pass-through `server/src/routes/diagram.ts` implements in
 * production. The one seam this leaves unexercised is that route's own
 * auth/cap/regex-guard layer — covered by `server/src/routes/diagram.test.ts`
 * — everything else (the note, the theme, the container's real Mermaid
 * render) is genuine.
 */
export async function forwardDiagramToRenderer(page: Page, rendererUrl: string): Promise<void> {
  await page.route(`${API_ORIGIN}/diagram`, async (route) => {
    const body = route.request().postData() ?? '{}';

    const upstream = await fetch(`${rendererUrl}/render/mermaid`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    await route.fulfill({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') ?? 'image/svg+xml',
      headers: corsHeaders,
      body: Buffer.from(await upstream.arrayBuffer()),
    });
  });
}
