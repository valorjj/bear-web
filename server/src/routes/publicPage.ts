import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { readPage } from '../publish/store.ts';
import { getPageOwner } from '../repositories/publish.ts';

/**
 * The only id shape a URL segment may carry.
 *
 * Checked here, BEFORE `getPageOwner` or `readPage` run, for a reason
 * distinct from every other route's copy of this guard: `readPage` THROWS on
 * an unsafe shape rather than sanitising it, and a thrown error here would
 * surface as a 500 — which would tell an anonymous reader "that id was
 * malformed" as opposed to "that id does not exist". Both cases must answer
 * the same 404, so the shape is rejected before it can reach either.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The content-security-policy that makes serving author HTML safe.
 *
 * Notes preserve raw HTML deliberately (`RawHtmlBlock`), so a published
 * document CAN contain a `<script>`. The bytes are the author's and are
 * served verbatim — this header neutralises them rather than stripping them:
 * `default-src 'none'` blocks every network-capable directive (scripts,
 * fetch, frames, workers, objects) that has no more specific source below it,
 * `img-src data:` and `font-src data:` allow the inlined assets K3 and export
 * already produce, and `style-src 'unsafe-inline'` allows the inline
 * styling the export pipeline emits without allowing script execution.
 */
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** The one route an anonymous reader can reach. No session, no cookie, no CORS. */
export function publicPageRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/p/:id', async (c) => {
    const id = c.req.param('id');
    // Before anything else touches the database or the filesystem: a bad
    // shape must 404 exactly like an unknown id, never a 500.
    if (!ID.test(id)) return c.body(null, 404);

    const owner = await getPageOwner(deps.query, id);
    if (owner === null) return c.body(null, 404);

    const html = await readPage(deps.env.publishRoot, owner.userId, id);
    // A row can exist without its file: the two are not written atomically,
    // so a crash between them leaves exactly that. Same 404 as an unknown id.
    if (html === null) return c.body(null, 404);

    const etag = `"${createHash('sha256').update(html).digest('hex')}"`;

    c.header('content-security-policy', CSP);
    c.header('x-content-type-options', 'nosniff');
    c.header('x-robots-tag', 'noindex, nofollow');
    c.header('referrer-policy', 'no-referrer');
    c.header('etag', etag);

    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304);
    }

    return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
  });

  return app;
}
