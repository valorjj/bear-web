import type { MiddlewareHandler } from 'hono';

/**
 * Splits one process into two hostnames.
 *
 * The Cloudflare tunnel points `api.` and `pub.` at the same port, so without
 * this the entire API — `/auth`, `/sync`, `/files`, `/publish` — answers on
 * the anonymous origin. Nothing authenticates there today (the session cookie
 * is host-only on `api.`), but exposing the whole surface on the host that
 * serves author-authored HTML is a standing invitation, and the OAuth
 * callback must never be reachable on a host that could set a cookie for it.
 *
 * Fails CLOSED in both directions: an unrecognised or absent `Host` is
 * treated as the app host, which serves no public pages.
 */
export function publishHostOnly(publishOrigin: string): MiddlewareHandler {
  const publishHost = new URL(publishOrigin).host.split(':')[0]!.toLowerCase();

  return async (c, next) => {
    // A port belongs to the socket, not the identity: local development
    // reaches the same process on one.
    const requestHost = (c.req.header('host') ?? '').split(':')[0]!.toLowerCase();
    const isPublishHost = requestHost === publishHost;
    const isPublicPath = c.req.path === '/health' || c.req.path.startsWith('/p/');

    if (isPublishHost && !isPublicPath) {
      // On the publish host, nothing but the public surface exists.
      return c.body(null, 404);
    }
    if (!isPublishHost && c.req.path.startsWith('/p/')) {
      // A published page exists on exactly one hostname.
      return c.body(null, 404);
    }

    return next();
  };
}
