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
 * The ceiling is a measured figure plus **roughly 2.5-3 KB of headroom** —
 * not a target, a limit. Raising it is a decision someone makes in a diff,
 * not a drift nobody notices.
 *
 * That margin is the PRACTICE, and it is written down here because the rule
 * this docblock used to state was "roughly 3%", which at today's size would be
 * ~10 KB. Nobody has ever left 10 KB: the raises below left 89 B, 187 B and
 * 745 B before settling on ~2.5-3 KB deliberately. Carrying a stated rule
 * nobody follows alongside a practice nobody wrote down is how a ceiling
 * silently comes to have 89 bytes of room. A small margin is the right choice
 * — it forces each growth to be measured on both sides — but it has to be the
 * one on the page.
 *
 * Raised from 333,000 by B2 Task 4 (drag the level badge to move a section)
 * on 2026-08-29, measured on both sides as this file's convention requires:
 * the branch before this task was **332,255 B** — **745 bytes of headroom**,
 * the third ceiling in a row to be all but exhausted before anyone looked —
 * and the finished task measures **333,303 B**, a true cost of **1,048 B
 * gzipped** for the pointer state machine, the boundary measurement, the
 * auto-scroll loop and the two new decorations. No dependency was added, and
 * the CSS is not in this asset. Headroom is again ~2.7 KB, deliberately,
 * matching what K1 and M9b left.
 */
const CEILING_BYTES = 340_000;

/**
 * Raised from 328,000 by M9b (callout blocks) on 2026-08-27, measured on both
 * sides. `main` was **327,813 B** — **187 bytes of headroom**, so the previous
 * ceiling was even closer to exhausted than K1 left it — and the finished
 * milestone measures **330,243 B**, a true cost of **2,430 B gzipped** for the
 * marker grammar, the extended blockquote node, the `calloutTitle` node,
 * `sanitize`'s repair, the type command, the placeholder plugin, the chevron
 * menu and the input rule.
 *
 * An interim raise to 332,000 was made mid-milestone and described the cost as
 * 844 B, which was the figure at that moment and not the feature's. Both the
 * number and the ceiling are corrected here rather than left to read as a
 * final measurement that was never taken.
 *
 * No dependency was added: `@tiptap/extension-blockquote` was already in the
 * bundle by way of StarterKit, so importing it directly is free. The five
 * icons cost nothing at all — they are `mask-image` data URIs in `tokens.css`,
 * which is CSS, not JS.
 *
 * Headroom is ~2.75 KB, matching what K1 deliberately left, so the next
 * ordinary change does not have to touch this line.
 */

/**
 * Raised from 336,000 by L2 (backlinks: the `[[wikilink]]` grammar, the
 * `noteLinks` derived index, the link pill, the backlinks panel and `[[`
 * autocomplete) on 2026-08-31, measured on both sides per this file's
 * convention: `main` (`8987ae6`, L1 merged) was **334,590 B** gzipped, and the
 * finished branch measures **337,236 B** — a true cost of **2,646 B gzipped**
 * across all six of L2's tasks combined (the shared masker move added
 * nothing; the grammar, index-repository wiring, pill decorations and
 * commands, backlinks panel, and autocomplete plugin account for the rest).
 * The branch was already **over** the previous 336,000 ceiling before this
 * raise, exactly as Task 4's own mid-milestone measurement predicted it would
 * be once Tasks 5 and 6 landed. `@tiptap/extensions` (for
 * `skipTrailingNodeMeta`) was added as a direct dependency but was already
 * present transitively via `@tiptap/extension-*` packages, so it cost
 * nothing new to the graph.
 *
 * Headroom is **2,764 B**, matching the ~2.5-3 KB this file's practice calls
 * for — not the ~10 KB the docblock above still describes as the historical
 * rule nobody has followed since K1.
 */

/**
 * Raised from 324,000 by K1 (image capture) on 2026-08-26, with the growth
 * measured on both sides rather than estimated: `main` was **323,911** —
 * 89 bytes of headroom, so the previous ceiling was all but exhausted — and
 * the whole feature costs **1,555 B gzipped**: the downscaler, the stored-image
 * node and its view, the reference-counted object-URL cache, the paste plugin
 * and the path contract. No dependency was added; this is all first-party code.
 *
 * The new headroom is deliberately ~2.5 KB rather than another 89 bytes, so
 * the next ordinary change does not have to touch this line again.
 */

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
