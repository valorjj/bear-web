import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from the apex `markflowing.com`, so the base is the domain root in
  // every environment. It previously varied under GITHUB_ACTIONS while Pages
  // served the app behind a repo-subpath prefix; the conditional is gone
  // rather than retargeted, because there is no longer an environment with a
  // path prefix.
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    /*
     * Two projects, because the environments are genuinely incompatible.
     * `vitest.setup.ts` installs jsdom and swaps the global `Blob` for Node's
     * so fake-indexeddb can structuredClone it — behaviour the app suite
     * depends on and the server suite must never see. The server project
     * therefore does NOT `extend`, so it inherits no setup file, no jsdom, and
     * no `globals`.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          css: true,
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
          // Every DB-touching test file in this project shares one live
          // MariaDB instance (see TEST_DATABASE_URL in CLAUDE.md). Running
          // files in parallel workers races their DROP/CREATE/DELETE
          // statements against each other — `migrate.test.ts`'s `beforeAll`
          // drops and recreates the account tables while `users.test.ts`
          // reads and writes them from a different worker. Files within
          // this project must run sequentially; the `app` project is
          // unaffected since it has its own config block.
          fileParallelism: false,
        },
      },
    ],
  },
});
