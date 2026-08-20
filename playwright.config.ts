import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  /*
   * The two design harnesses (`e2e/shots.spec.ts` and `e2e/measure.spec.ts`)
   * share this config for its webServer and baseURL, but are not part of the
   * suite: they assert nothing and write PNGs and a report. Excluded by default
   * so `npm run test:e2e` keeps both its runtime and its documented test count;
   * `npm run shots` and `npm run measure` set PW_HARNESS to turn the exclusion
   * off.
   */
  grepInvert: process.env.PW_HARNESS ? undefined : /@shots|@measure/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
