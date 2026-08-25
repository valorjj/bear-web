import { closeSharedBrowser } from './render.ts';
import { startRenderServer } from './server.ts';

const server = startRenderServer();

/*
 * Without this, `docker compose down` / a container restart kills the process
 * outright and Chromium's own children are left to the container teardown.
 * Closing the browser first means a restart cannot leave a renderer holding
 * memory against the next container's `mem_limit`.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closeSharedBrowser().finally(() => process.exit(0));
    });
  });
}
