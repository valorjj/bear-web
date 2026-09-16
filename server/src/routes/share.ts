import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { readPage } from '../publish/store.ts';
import { getPageOwner } from '../repositories/publish.ts';

/**
 * The only id shape a URL segment may carry.
 *
 * Checked BEFORE `getPageOwner` or `readPage` run, for the same reason
 * `publicPage.ts` checks it there: `readPage` THROWS on an unsafe shape
 * rather than sanitising it, and a thrown error would surface as a 500 —
 * telling an anonymous caller "that id was malformed" as opposed to "that id
 * does not exist". Both answer the same 404.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The published document, served to the APP rather than to a reader.
 *
 * Same bytes as `GET /p/:id`, same capability, different host — and the host
 * is the whole reason this route exists. The app cannot fetch `/p/:id`:
 * `app.ts`'s CORS middleware deliberately skips the publish host so the app's
 * credentialed posture does not leak onto the anonymous one, and a
 * cross-origin `fetch` without `access-control-allow-origin` is blocked by
 * the browser. Adding that header to the publish host would reverse a
 * deliberate decision in order to save this file.
 *
 * Here on the API host, the existing CORS middleware and `originGuard` both
 * apply, and `originGuard` exempts GET. `publishHostOnly` already 404s
 * everything but `/health` and `GET|HEAD /p/*` on the publish host, so this
 * route is unreachable there by construction and that middleware needs no
 * change.
 *
 * No CSP: nothing renders this. The client parses it and throws the document
 * away.
 */
export function shareRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/share/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) return c.body(null, 404);

    const owner = await getPageOwner(deps.query, id);
    if (owner === null) return c.body(null, 404);

    const html = await readPage(deps.env.publishRoot, owner.userId, id);
    // A row can exist without its file: the two are not written atomically,
    // so a crash between them leaves exactly that. Same 404 as an unknown id.
    if (html === null) return c.body(null, 404);

    return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
  });

  return app;
}
