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
    /**
     * Every spec lands in the app, not on the landing screen.
     *
     * Solved here rather than with a `dismissLanding(page)` helper called from
     * each spec: a helper leaves a trap, and a spec written months from now
     * that forgets the call presents as "my new test mysteriously sees a login
     * page" with nothing pointing at the cause. A config default cannot be
     * forgotten. `e2e/landing.spec.ts` opts out explicitly.
     *
     * BOTH keys, not just `seen`. Setting only `seen` closes the gate but
     * leaves the SEED condition live, and the 13 specs that start with an
     * empty database would each get a welcome note injected into the list they
     * assert against -- a selective failure that looks unrelated to this change.
     */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'bear-web:landing:seen', value: '1' },
            { name: 'bear-web:landing:seeded', value: '1' },
          ],
        },
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
