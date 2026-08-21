import { Hono } from 'hono';

import { authRoutes } from './auth/routes.ts';
import type { Env } from './env.ts';
import { originGuard } from './middleware/origin.ts';
import { clientIp, rateLimit } from './middleware/rateLimit.ts';
import { accountRoutes } from './routes/account.ts';

/** A parameterised SQL call. The only shape route code may use. */
export type Query = (sql: string, params?: readonly unknown[]) => Promise<unknown[]>;

export interface AppDeps {
  env: Env;
  query: Query;
  /** Injected so the provider's token endpoint is reachable in tests without the network. */
  fetch: typeof globalThis.fetch;
  /** False only for http://localhost, where a Secure cookie would be dropped. */
  secureCookies: boolean;
}

/**
 * Builds the app from injected dependencies and does not listen.
 *
 * Hono's `app.request()` drives a built app in-process, so every route test
 * runs without a port — which matters more than usual here: two parallel test
 * runs on one port is exactly the failure `playwright.config.ts` already
 * documents for 4173.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Same-site, different origin: the cookie is sent, but the response is only
  // readable with these headers. `credentials` is what makes the cookie count.
  //
  // Registered BEFORE originGuard, not after: originGuard returns 403 without
  // calling `next()`, so a CORS middleware registered later would never run on
  // a rejected request and the browser would report an opaque CORS error
  // instead of the 403 the server actually sent. This middleware calls
  // `await next()` first and sets headers on the way back out, so it still
  // decorates the 403 response.
  app.use('*', async (c, next) => {
    await next();
    c.header('access-control-allow-origin', deps.env.appOrigin);
    c.header('access-control-allow-credentials', 'true');
  });

  app.options('*', (c) => {
    c.header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    c.header('access-control-allow-headers', 'content-type');
    return c.body(null, 204);
  });

  app.use('*', originGuard([deps.env.appOrigin]));

  // Auth is limited by IP, because an unauthenticated caller has no user id to
  // limit by — and the login endpoints are the ones reachable without a session.
  app.use('/auth/*', rateLimit({ limit: 20, windowMs: 60_000, key: clientIp }));
  app.use('*', rateLimit({ limit: 300, windowMs: 60_000, key: clientIp }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));
  app.route('/', accountRoutes(deps));

  return app;
}
