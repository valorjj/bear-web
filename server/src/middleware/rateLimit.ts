import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: (c: Context) => string;
}

/**
 * A fixed-window counter held in memory.
 *
 * In memory because the service is a single process behind one tunnel; a Redis
 * dependency would buy nothing until there is a second instance. **If a second
 * instance ever appears, this becomes per-instance and the effective limit
 * multiplies** — which is why the state is deliberately trivial to relocate.
 *
 * Open signup is what makes this a day-one requirement rather than later
 * hardening: without it one script fills the Mini's disk.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const now = Date.now();
    const key = options.key(c);
    const current = windows.get(key);

    if (current === undefined || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.limit) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      c.header('retry-after', String(retryAfter));
      return c.json({ error: 'too many requests' }, 429);
    }

    current.count += 1;
    return next();
  };
}

/** The client IP as Cloudflare reports it, falling back to the socket. */
export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}
