import { Hono } from 'hono';

import { cookieName, readCookie, SESSION_COOKIE } from './auth/cookies.ts';
import { authRoutes } from './auth/routes.ts';
import type { Env } from './env.ts';
import { originGuard } from './middleware/origin.ts';
import { publishHostOnly } from './middleware/publishHost.ts';
import { clientIp, rateLimit } from './middleware/rateLimit.ts';
import { accountRoutes } from './routes/account.ts';
import { diagramRoutes } from './routes/diagram.ts';
import { exportRoutes } from './routes/export.ts';
import { fileRoutes } from './routes/files.ts';
import { publicPageRoutes } from './routes/publicPage.ts';
import { publishRoutes } from './routes/publish.ts';
import { syncRoutes } from './routes/sync.ts';

/** A parameterised SQL call. The only shape route code may use. */
export type Query = (sql: string, params?: readonly unknown[]) => Promise<unknown[]>;

/**
 * Runs several statements atomically on ONE connection.
 *
 * `Query` picks an arbitrary connection from the pool per call, so two
 * consecutive `query` calls are two independent transactions no matter how
 * they read. That was a live bug — a user row could outlive the failed insert
 * of the identity that justified it — and it is unimplementable-as-designed
 * for D2, whose per-user revision counter the spec requires be incremented
 * "in the same transaction as every write".
 *
 * The callback receives a `Query` bound to that one connection, so a
 * repository written against `Query` works inside a transaction unchanged.
 * Committed when the callback resolves, rolled back when it throws.
 */
export type Transaction = <T>(run: (query: Query) => Promise<T>) => Promise<T>;

export interface AppDeps {
  env: Env;
  query: Query;
  /** For anything that must be atomic. See `Transaction`. */
  transaction: Transaction;
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

  // The publish host serves only `GET /health` and `GET /p/*`, and never a
  // credentialed response — so it must never carry the app's CORS headers
  // below, and no app route (`/auth`, `/sync`, `/files`, `/export`,
  // `/diagram`, `/publish`) may be reachable there at all. Registered FIRST:
  // a request that does not belong on this host should not be decorated with
  // the app's CORS headers on its way to a 404, nor reach originGuard.
  app.use('*', publishHostOnly(deps.env.publishOrigin));

  const publishHost = new URL(deps.env.publishOrigin).host.split(':')[0]!.toLowerCase();

  // Same-site, different origin: the cookie is sent, but the response is only
  // readable with these headers. `credentials` is what makes the cookie count.
  //
  // Registered BEFORE originGuard, not after: originGuard returns 403 without
  // calling `next()`, so a CORS middleware registered later would never run on
  // a rejected request and the browser would report an opaque CORS error
  // instead of the 403 the server actually sent. This middleware calls
  // `await next()` first and sets headers on the way back out, so it still
  // decorates the 403 response.
  //
  // Skipped on the publish host: a published page is not a credentialed
  // response, and stamping the app's origin and `allow-credentials` onto it
  // would leak the app's CORS posture onto the anonymous host.
  app.use('*', async (c, next) => {
    await next();
    const requestHost = (c.req.header('host') ?? '').split(':')[0]!.toLowerCase();
    if (requestHost === publishHost) return;
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

  // Per-session rather than per-IP, per the spec's "per-user on /sync". Keys
  // on the extracted session TOKEN, not the raw `Cookie` header — a client
  // controls its own header verbatim, so keying on the whole string lets any
  // caller dodge the limit by appending junk (`; x=1`, `; x=2`, ...) to a
  // cookie it already owns, which both defeats the limit and grows the
  // unbounded window Map faster than intended. Falls back to the IP bucket
  // only when the named cookie is absent, which is correct: that caller is
  // about to get a 401 anyway. The cookie name itself depends on
  // `secureCookies` (the `__Host-` prefix), so it must be resolved through
  // `cookieName`, not hardcoded.
  const sessionCookieName = cookieName(SESSION_COOKIE, deps.secureCookies);
  app.use(
    '/sync',
    rateLimit({
      limit: 120,
      windowMs: 60_000,
      key: (c) => readCookie(c.req.header('cookie'), sessionCookieName) ?? clientIp(c),
    }),
  );
  // Far tighter than /sync's 120: one render costs orders of magnitude more
  // than a sync round-trip, and it runs a browser rather than a query.
  app.use(
    '/export/*',
    rateLimit({
      limit: 10,
      windowMs: 60_000,
      key: (c) => readCookie(c.req.header('cookie'), sessionCookieName) ?? clientIp(c),
    }),
  );
  // Deliberately between /sync's 120 and /export/*'s 10, not equal to
  // either. /export/* is 10/min because a PDF render takes seconds and a
  // user exports occasionally; a diagram render is ~100ms, and the editor
  // issues one per edit-then-leave-the-block, so someone iterating on a
  // diagram — or opening a diagram-heavy note for the first time — legitimately
  // produces a burst of them. At 10/min, normal editing would present as
  // diagrams mysteriously failing to render while the user works. 60 still
  // bounds abuse hard: the renderer's own queue (Task 3) admits only 2
  // concurrent renders and sheds past a depth of 8, so the container is
  // protected by that as well as by this.
  app.use(
    '/diagram',
    rateLimit({
      limit: 60,
      windowMs: 60_000,
      key: (c) => readCookie(c.req.header('cookie'), sessionCookieName) ?? clientIp(c),
    }),
  );
  // The public route: no session, so keyed by IP like /auth's. A reader with
  // no cookie has nothing else to key on, and this is the one route the
  // publish host actually serves.
  app.use('/p/*', rateLimit({ limit: 120, windowMs: 60_000, key: clientIp }));
  app.use('*', rateLimit({ limit: 300, windowMs: 60_000, key: clientIp }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));
  app.route('/', accountRoutes(deps));
  app.route('/', syncRoutes(deps));
  app.route('/', exportRoutes(deps));
  app.route('/', diagramRoutes(deps));
  app.route('/', fileRoutes(deps));
  app.route('/', publishRoutes(deps));
  app.route('/', publicPageRoutes(deps));

  return app;
}
