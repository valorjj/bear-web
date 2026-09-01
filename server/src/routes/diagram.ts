import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { readCappedBody } from '../http/body.ts';
import { findUnsafeSvgConstructs } from '../../pdf/svgGuard.ts';

/**
 * The largest diagram source this service will render, in bytes.
 *
 * 20 KB, not the export route's 20 MB: that number sizes a RENDERED document
 * with images inlined as data URIs, and this is a few lines of DSL. A diagram
 * larger than this is not a diagram.
 */
export const MAX_DIAGRAM_BYTES = 20 * 1024;

/**
 * The authenticated pass-through in front of the Mermaid renderer.
 *
 * The renderer (a separate, unauthenticated container listening only on
 * 127.0.0.1:8788) is not reachable from the browser at all — this route is
 * the only door. It requires a session the same way `/export/pdf` does, caps
 * the body BEFORE forwarding it (a cap enforced after the forward is not a
 * cap), and forwards as `application/json` since that is what the renderer's
 * `/render/mermaid` endpoint requires.
 *
 * It also runs `findUnsafeSvgConstructs` on the renderer's response before
 * returning it. The container already sanitizes with a real DOM walk, and
 * already runs this same guard before responding — running it again here is
 * NOT redundant: it is defence in depth against a mis-deployed,
 * restarted-with-old-image, or replaced renderer. This route is the last
 * thing between that container and markup the browser will inline into the
 * user's own notes, so a guard failure here means the renderer answered with
 * something broken, and that is reported as 502 rather than passed through.
 */
export function diagramRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.post('/diagram', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.body(null, 401);

    // Before the forward, deliberately. A cap enforced after the renderer has
    // been handed the body is not a cap.
    const raw = await readCappedBody(c.req.raw, MAX_DIAGRAM_BYTES);
    if (raw === null) return c.body(null, 413);

    let source: unknown;
    try {
      source = (JSON.parse(raw) as { source?: unknown }).source;
    } catch {
      return c.body(null, 400);
    }
    if (typeof source !== 'string') return c.body(null, 400);

    let response: Response;
    try {
      response = await deps.fetch(`${deps.env.pdfRendererUrl}/render/mermaid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
    } catch {
      // Unreachable is not the same as broken: the renderer is a separate
      // container that can be restarting, and the client's message differs.
      return c.body(null, 503);
    }

    // 422 is the renderer blaming the user's diagram syntax, not itself — its
    // JSON body carries the parser's own message, and that has to reach the
    // user, so it is passed through rather than collapsed into a generic
    // error. 503 (queue full) and 504 (render timed out) both mean "try
    // again shortly", not "the render is broken", so they also pass through
    // unchanged. Anything else non-OK is reported as 502.
    if (response.status === 422) {
      const body = await response.text();
      return c.body(body, 422, { 'content-type': 'application/json' });
    }
    if (response.status === 503) return c.body(null, 503);
    if (response.status === 504) return c.body(null, 504);
    if (!response.ok) return c.body(null, 502);

    const svg = await response.text();
    if (findUnsafeSvgConstructs(svg).length > 0) return c.body(null, 502);

    return c.body(svg, 200, { 'content-type': 'image/svg+xml' });
  });

  return app;
}
