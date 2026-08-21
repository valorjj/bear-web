import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createPool } from './db/pool.ts';
import { readEnv } from './env.ts';

const env = readEnv(process.env);
const { query } = createPool(env.databaseUrl);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp({ env, query }).fetch, port });

console.log(`listening on http://localhost:${port}`);
