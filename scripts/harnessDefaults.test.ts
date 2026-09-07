import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from '../src/features/landing/gate.ts';

/**
 * `vitest.setup.ts` and `playwright.config.ts` both pre-dismiss the landing
 * gate, and both must spell these keys as LITERALS — neither may import from
 * `src/` (the setup file is in the `node` tsconfig project; the config is in
 * `e2e`). A rename here would silently un-dismiss the gate in both harnesses
 * and turn 37 e2e specs and much of the component suite red at once, with the
 * cause nowhere near the failures.
 *
 * This test is the thing that makes that rename fail loudly, and here. It
 * lives under `scripts/` rather than `src/features/landing/` (where the
 * plan originally placed it) because `tsconfig.node.json` already includes
 * `scripts` with real Node types, so `node:fs` needs no ambient declaration
 * here — unlike under `src/`, where `tsconfig.app.json` deliberately has no
 * Node types (CLAUDE.md requires a `process.env` reference under `src/` to
 * fail typecheck), and an ambient `declare module 'node:fs'` placed there to
 * work around it would be global to the whole `app` project, not scoped to
 * one file, defeating that same guard for every other file in it.
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
