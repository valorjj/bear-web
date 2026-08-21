import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createPool } from './db/pool.ts';
import { readEnv } from './env.ts';

const env = readEnv(process.env);
const { query } = createPool(env.databaseUrl);

const port = Number(process.env.PORT ?? 8787);

const app = createApp({
  env,
  query,
  fetch: globalThis.fetch,
  // http://localhost drops a Secure cookie, so dev must opt out. Anything
  // reached over https — which is everything behind the tunnel — opts in.
  secureCookies: env.apiOrigin.startsWith('https://'),
});

serve({ fetch: app.fetch, port });

console.log(`listening on http://localhost:${port}`);
