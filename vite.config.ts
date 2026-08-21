import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

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
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
    ],
  },
});
