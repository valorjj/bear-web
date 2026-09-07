import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from './gate';

/**
 * `vitest.setup.ts` and `playwright.config.ts` both pre-dismiss the landing
 * gate, and both must spell these keys as LITERALS — neither may import from
 * `src/` (the setup file is in the `node` tsconfig project; the config is in
 * `e2e`). A rename here would silently un-dismiss the gate in both harnesses
 * and turn 37 e2e specs and much of the component suite red at once, with the
 * cause nowhere near the failures.
 *
 * This test is the thing that makes that rename fail loudly, and here.
 */
describe('harness defaults', () => {
  it.each([
    ['vitest.setup.ts', 'vitest.setup.ts'],
    ['playwright.config.ts', 'playwright.config.ts'],
  ])('%s dismisses the landing gate by literal key', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain(LANDING_SEEN_KEY);
    expect(source).toContain(LANDING_SEEDED_KEY);
  });
});
