import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createPool } from './db/pool.ts';
import { readEnv } from './env.ts';

const env = readEnv(process.env);
const { query, transaction } = createPool(env.databaseUrl);

const port = Number(process.env.PORT ?? 8787);

// Loopback by default, so the Cloudflare Tunnel is the only path in. This is
// load-bearing rather than tidy: `clientIp` trusts `cf-connecting-ip` /
// `x-forwarded-for` verbatim, so a LAN client reaching the process directly
// self-reports any address it likes and gets a fresh rate-limit bucket per
// request. Overridable for a deployment that fronts it differently; the
// default must stay loopback.
const hostname = process.env.HOST ?? '127.0.0.1';

const app = createApp({
  env,
  query,
  transaction,
  fetch: globalThis.fetch,
  // http://localhost drops a Secure cookie, so dev must opt out. Anything
  // reached over https — which is everything behind the tunnel — opts in.
  secureCookies: env.apiOrigin.startsWith('https://'),
});

serve({ fetch: app.fetch, port, hostname });

console.log(`listening on http://${hostname}:${port}`);
