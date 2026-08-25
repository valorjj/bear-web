import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * The `pdf` Vitest project is excluded from the default `vitest run`, because
 * its `beforeAll` launches a real Chromium and `npm test` is one of six gates
 * a developer runs constantly on a fanless machine.
 *
 * The cost of that exclusion is that the suite is now invisible to every
 * command anyone runs by habit. Nothing else in the repo would notice it
 * disappearing from CI — it would simply stop running, green. Same reasoning
 * as `server/src/db/migrate.test.ts` asserting `TEST_DATABASE_URL` is set
 * whenever `CI` is: a suite that silently runs nothing is worse than a red one.
 */
describe('CI runs every suite the default `npm test` skips', () => {
  it('excludes the pdf project from the default test script', () => {
    expect(packageJson.scripts.test).toContain('!pdf');
  });

  it('still has a script that runs the pdf project', () => {
    expect(packageJson.scripts['test:pdf']).toContain('--project pdf');
  });

  it('invokes that script from the CI workflow', () => {
    expect(workflow, 'ci.yml must run the pdf suite explicitly').toContain('npm run test:pdf');
  });

  it('runs it AFTER the Playwright browser is installed', () => {
    // `chromium.launch()` throws `Executable doesn't exist` otherwise, and the
    // ordering is the whole reason this step is separate rather than folded
    // into the unit-test step.
    const install = workflow.indexOf('playwright install');
    const run = workflow.indexOf('npm run test:pdf');

    expect(install, 'the workflow must install a browser').toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(install);
  });
});
