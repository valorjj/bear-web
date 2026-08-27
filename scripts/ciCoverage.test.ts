import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

/**
 * `workflow` with its YAML comments stripped.
 *
 * Every assertion below that means "CI actually RUNS this" must read this and
 * not `workflow`. A `toContain('npm run measure')` against the raw file passes
 * against the PROSE explaining why the step exists — demonstrated by deleting
 * the step and watching the test stay green. That is the same near-vacuous
 * shape `docs/rulings/testing-and-tooling.md` collects: an assertion that
 * cannot distinguish the thing from a mention of the thing.
 */
const commands = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * The `pdf` Vitest project is not even DEFINED unless `VITEST_PDF=1`, because
 * its `beforeAll` launches a real Chromium and `npm test` is one of six gates
 * a developer runs constantly on a fanless machine. A script-level
 * `--project='!pdf'` filter was the first attempt and was not enough: bare
 * `npm run test:watch` passes no filter and would still have launched a
 * browser.
 *
 * The cost of that exclusion is that the suite is now invisible to every
 * command anyone runs by habit. Nothing else in the repo would notice it
 * disappearing from CI — it would simply stop running, green. Same reasoning
 * as `server/src/db/migrate.test.ts` asserting `TEST_DATABASE_URL` is set
 * whenever `CI` is: a suite that silently runs nothing is worse than a red one.
 */
describe('CI runs every suite the default `npm test` skips', () => {
  it('defines the pdf project only INSIDE the VITEST_PDF gate', () => {
    /*
     * Structural, not a bare `toContain`. Asserting the file merely mentions
     * `VITEST_PDF` somewhere would pass on a gate that guards nothing, so this
     * checks that the project literal sits between the gate's condition and
     * the empty-array branch that closes it.
     *
     * It is a source check because the obvious behavioural one does not work:
     * importing `vite.config.ts` from a test throws `The URL must be of scheme
     * file` — the config calls `fileURLToPath(new URL('./src',
     * import.meta.url))`, and under jsdom `import.meta.url` is not a file URL.
     * The behavioural equivalent is `npx vitest list`, which is a subprocess
     * this suite should not pay for on every run; it was verified by hand
     * instead (0 files under server/pdf/ with the flag unset).
     */
    const gate = viteConfig.indexOf("process.env.VITEST_PDF === '1'");
    expect(gate, 'the pdf project must be gated on an env var').toBeGreaterThan(-1);

    const closer = viteConfig.indexOf(': []', gate);
    expect(closer).toBeGreaterThan(gate);
    expect(viteConfig.slice(gate, closer)).toContain("name: 'pdf'");
  });

  it('still has a script that runs the pdf project, and sets the flag', () => {
    expect(packageJson.scripts['test:pdf']).toContain('--project pdf');
    expect(packageJson.scripts['test:pdf']).toContain('VITEST_PDF=1');
  });

  it('gates the project on that same env var', () => {
    expect(viteConfig).toContain('VITEST_PDF');
  });

  it('invokes that script from the CI workflow', () => {
    expect(commands, 'ci.yml must run the pdf suite explicitly').toContain('npm run test:pdf');
  });

  /*
   * NOT a CI step, and that is a measured decision rather than an oversight.
   *
   * It ran in `ci.yml` for exactly one commit and failed: text-derived widths
   * differ between ubuntu and macOS. The scope header button measured 68.7 on
   * macOS and 70 on ubuntu; the tag pill 573.6 against 564.2 — a 9.4px gap,
   * which is LARGER than real design changes worth catching (sub-project I
   * moved a row height by 4px). No tolerance separates that signal from that
   * noise, so the comparison only means anything on the machine that generated
   * the file. Every height and style value did match; it is widths alone.
   *
   * So the check is `npm run measure:check`, run locally where the platform
   * agrees with itself. This guards the script rather than the workflow.
   */
  it('ships a measure:check script that FAILS on a stale reference', () => {
    const script = packageJson.scripts['measure:check'];
    expect(script, 'measure:check must exist').toBeDefined();
    expect(script, 'it must regenerate the measurements').toContain('npm run measure');
    expect(script, 'it must fail on a diff rather than silently rewriting').toContain(
      'git diff --exit-code',
    );
    expect(script).toContain('docs/design/measurements.md');
  });

  it('does NOT run the measurement check in CI, where it cannot be trusted', () => {
    // Guards the finding above against a well-meaning "why isn't this in CI?"
    // If you are re-adding it, read this block's comment first.
    expect(commands, 'measure must not run in ci.yml — see the comment above').not.toContain(
      'npm run measure',
    );
  });

  it('runs it AFTER the Playwright browser is installed', () => {
    // `chromium.launch()` throws `Executable doesn't exist` otherwise, and the
    // ordering is the whole reason this step is separate rather than folded
    // into the unit-test step.
    const install = commands.indexOf('playwright install');
    const run = commands.indexOf('npm run test:pdf');

    expect(install, 'the workflow must install a browser').toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(install);
  });
});
