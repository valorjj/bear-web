import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The gzipped ceiling for the main bundle.
 *
 * `278,028 B` was `main` before sub-project C (commit `652d3e5`). C's own
 * plan recorded an eager-loading estimate of `+23,216 B` (a spike measurement)
 * and this file originally carried a ceiling of `310_000` derived from it.
 * Both were wrong: four independent re-measurements during C's execution
 * (Task 2, Task 7 twice, and this task) found the real HEAD figure repeatedly
 * higher than the spike predicted, ending at a measured **`314,367 B`** —
 * a true delta of **`+36,339 B`**, 57% above the `+23,216` the eager decision
 * was originally made on. The `auto-*.js` chunk is excluded from this
 * reasoning entirely: it is byte-identical before and after C (it is
 * fake-indexeddb error strings), so none of its ~56 KB raw / ~15 KB gzip is
 * C's cost.
 *
 * The eager-loading decision itself still stands — it rested on a lazy
 * loader's silent-failure mode (a spike that compiled, ran, and highlighted
 * nothing), not on the byte count — but the byte count that decision was
 * described with was never right, four times over. See
 * `docs/superpowers/NEXT.md`'s C section for the full measurement history.
 *
 * The ceiling here is the measured `314,367 B` plus roughly 3% headroom for
 * ordinary churn — not a target, a limit. Raising it is a decision someone
 * makes in a diff, not a drift nobody notices.
 */
const CEILING_BYTES = 324_000;

describe('bundle size', () => {
  it('keeps the gzipped main bundle under its ceiling', () => {
    // Vitest sets `NODE_ENV=test` and `VITEST=true` on ITS OWN process, and
    // `execSync` inherits both into the child by default. Vite's build reads
    // `NODE_ENV` to pick its mode, so an inherited `test` value builds an
    // unminified, ~20% larger bundle (measured: 379,750 B gzipped instead of
    // 314,269 B) — a false failure with no code change behind it. Forcing
    // `production` here reproduces exactly what `npm run build` measures from
    // a plain shell.
    execSync('npm run build', { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
    const assets = readdirSync('dist/assets');
    const js = assets.filter((name) => name.endsWith('.js'));
    expect(js.length, 'no JS asset found — did the build run?').toBeGreaterThan(0);

    const largest = js
      .map((name) => ({ name, size: statSync(`dist/assets/${name}`).size }))
      .sort((a, b) => b.size - a.size)[0]!;

    const gzipped = gzipSync(readFileSync(`dist/assets/${largest.name}`)).length;
    expect(gzipped, `${largest.name} is ${gzipped} B gzipped`).toBeLessThan(CEILING_BYTES);
  }, 30_000);
});
