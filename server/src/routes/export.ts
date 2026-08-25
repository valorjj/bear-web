import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { readCappedBody } from '../http/body.ts';

/**
 * The largest document this service will render, in bytes.
 *
 * A note's text is quota-limited to 10 MiB, but the EXPORT HTML is a rendered
 * document, not the text, and 2 MiB of it is already an unreasonably large
 * single note. The cap exists because a render is the most expensive thing
 * this service does: without it, one POST of arbitrary size is buffered into
 * memory on a Mac Mini and then handed to a browser.
 */
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

/**
 * The authenticated pass-through in front of the PDF renderer.
 *
 * The renderer (a separate, unauthenticated container listening only on
 * 127.0.0.1:8788) is not reachable from the browser at all — this route is
 * the only door. It requires a session the same way `/sync` does, caps the
 * body BEFORE forwarding it (a cap enforced after the forward is not a cap),
 * and sends `content-type: text/html` because the renderer requires it and
 * refuses anything else with 415 — deliberately, since `text/html` is not a
 * CORS-safelisted content type and that keeps the renderer unreachable by a
 * simple cross-origin fetch from any page the user happens to be browsing.
 */
export function exportRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.post('/export/pdf', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.body(null, 401);

    // Before the forward, deliberately. A cap enforced after the renderer has
    // been handed the body is not a cap.
    const html = await readCappedBody(c.req.raw, MAX_EXPORT_BYTES);
    if (html === null) return c.body(null, 413);

    let response: Response;
    try {
      response = await deps.fetch(`${deps.env.pdfRendererUrl}/render`, {
        method: 'POST',
        headers: { 'content-type': 'text/html' },
        body: html,
      });
    } catch {
      // Unreachable is not the same as broken: the renderer is a separate
      // container that can be restarting, and the client's message differs.
      return c.body(null, 503);
    }

    // The renderer sheds load with its own 503 past a queue depth of 8, or
    // refuses outright past 16 in-flight requests before reading a byte —
    // both mean "try again shortly", not "the render is broken", so they
    // pass straight through rather than collapsing into 502.
    if (response.status === 503) return c.body(null, 503);
    if (response.status === 504) return c.body(null, 504);
    if (!response.ok) return c.body(null, 502);

    c.header('content-type', 'application/pdf');
    return c.body(await response.arrayBuffer());
  });

  return app;
}
