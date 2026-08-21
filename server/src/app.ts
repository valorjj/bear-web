import { Hono } from 'hono';

import { authRoutes } from './auth/routes.ts';
import type { Env } from './env.ts';

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

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));

  return app;
}
