import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/. Local dev serves from /.
  base: process.env.GITHUB_ACTIONS ? '/bear-web/' : '/',
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
