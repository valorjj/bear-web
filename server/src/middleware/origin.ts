import type { MiddlewareHandler } from 'hono';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie authentication.
 *
 * A `SameSite=Lax` cookie is not sent on a cross-site `fetch`, which already
 * blocks the classic attack — but Lax IS sent on a cross-site top-level
 * navigation, and this service is same-site with the app, so a second check
 * belongs here rather than being assumed away.
 *
 * Safe methods are exempt: a top-level GET carries no `Origin` in some
 * browsers, and guarding it would break the app rather than protect it.
 */
export function originGuard(allowed: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE.has(c.req.method)) return next();

    const origin = c.req.header('origin');
    if (origin === undefined || !allowed.includes(origin)) {
      return c.json({ error: 'origin not allowed' }, 403);
    }
    return next();
  };
}
