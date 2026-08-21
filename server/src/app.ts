import { Hono } from 'hono';

import type { Env } from './env.ts';

/** A parameterised SQL call. The only shape route code may use. */
export type Query = (sql: string, params?: readonly unknown[]) => Promise<unknown[]>;

export interface AppDeps {
  env: Env;
  query: Query;
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

  // Routes are added here by later tasks. `deps` is referenced so this
  // signature is load-bearing from the first commit rather than growing a
  // parameter later.
  void deps;

  return app;
}
