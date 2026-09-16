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
 * The published document, served to the APP rather than to a reader — but
 * still author-controlled bytes, reachable by a plain `GET` anyone can
 * navigate to directly, on the API host that holds the `__Host-` session
 * cookie and serves `/sync`, `/files`, `/account` and `/publish`.
 *
 * **This used to carry a comment claiming "nothing renders this. The client
 * parses it and throws the document away", and that was wrong.** It is true
 * of `fetchSharedPage`, the intended caller — but the intended caller is not
 * the only one who can reach a plain GET. Before this route existed, these
 * bytes were reachable on exactly one hostname: `publishHostOnly` 404s `/p/*`
 * on the API host and 404s everything but `/p/*` and `/health` on the
 * publish host. This route was the first path by which author HTML could be
 * served as `text/html` from the API host, and notes preserve raw HTML
 * deliberately (`RawHtmlBlock`), so a published document can contain a
 * `<script>`. An attacker who signs in, publishes a note whose body is a
 * `<script>`, and sends a victim this URL would have gotten same-origin
 * script execution with the victim's session cookie attached.
 *
 * Two independent defences, not one — either alone is not enough:
 *
 * 1. `text/plain`, not `text/html`. `fetchSharedPage` calls `response.text()`
 *    and `parseSharedPage` passes `'text/html'` to `DOMParser` explicitly, so
 *    the real caller never looks at this header — but a browser navigated
 *    here directly will not render markup served as plain text.
 * 2. `content-security-policy: default-src 'none'; sandbox` plus
 *    `x-content-type-options: nosniff`, in case a browser or proxy ever
 *    reinterprets the content type anyway. `sandbox` with no allow-list
 *    denies scripts, forms, and top-level navigation from a document loaded
 *    this way — strictly stronger than `/p/:id`'s CSP, which has to allow
 *    inline styles and data URIs for a real reader; this route has no reader
 *    to serve, so nothing needs to render here at all. `x-robots-tag` and
 *    `referrer-policy` mirror `/p/:id` for the same reason they exist there:
 *    these bytes are not meant to be indexed or to leak via Referer.
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

    c.header('content-security-policy', "default-src 'none'; sandbox");
    c.header('x-content-type-options', 'nosniff');
    c.header('x-robots-tag', 'noindex, nofollow');
    c.header('referrer-policy', 'no-referrer');

    return c.body(html, 200, { 'content-type': 'text/plain; charset=utf-8' });
  });

  return app;
}
