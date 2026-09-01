import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

/**
 * ## What this guard measures, and why (added 2026-08-31, L4 guard fix)
 *
 * This test used to find "the largest single JS asset" in `dist/assets` and
 * assert IT stayed under the ceiling, using largest-asset as a proxy for
 * "what the browser downloads before the app runs". That proxy was valid
 * exactly as long as the eager code compiled to one chunk — which it did,
 * until L4 added a second `React.lazy` boundary (`CommandPalette`, alongside
 * K1's `GraphView`) and Rolldown responded by re-chunking the eager code
 * itself across THREE files instead of one.
 *
 * Measured on 2026-08-31:
 * - `main`: 4 JS assets, eager code in ONE chunk — `index-*.js` at
 *   **338,350 B** gzipped. The old guard saw 338,350 and passed. Correct.
 * - this branch (`l4-command-palette`): 8 JS assets, eager code split across
 *   THREE chunks — `themes-*` 230,427 + `index-*` 62,825 + `EmptyState-*`
 *   49,791 (+ a 368 B `rolldown-runtime` shim) = **343,411 B** truly eager.
 *   The old guard looked only at `themes-*`, the single largest file, saw
 *   230,427, and PASSED — while the real eager payload was already ~3.4 KB
 *   OVER the (then-)340,000 ceiling. The guard was silently defanged: any
 *   future feature could grow the real eager payload without this test ever
 *   noticing, because "largest asset" and "eager payload" had quietly become
 *   different sets of bytes.
 *
 * The fix: read the build's own manifest (`build.manifest: true` in
 * `vite.config.ts`) rather than inferring structure from filenames or sizes.
 * The manifest names exactly one entry (`isEntry: true`) and lists each
 * chunk's STATIC `imports` (always loaded) separately from its
 * `dynamicImports` (loaded only on demand, e.g. `React.lazy`). This test
 * walks `imports` transitively from the entry — that closure IS the eager
 * payload — and never follows `dynamicImports`, which is the lazy code the
 * ceiling is deliberately meant to exclude. If the manifest is ever missing,
 * this test fails loudly rather than silently falling back to a weaker
 * check: "exists, unrun, silently stale" is this repo's worst state for a
 * reference file, because it looks like coverage.
 *
 * `auto-MqApsTLc.js` (fake-indexeddb's error strings, 14,979 B gzipped) has
 * a byte-identical filename hash on `main` and on this branch, and the
 * manifest classifies it as a `dynamicImports` entry reached only through
 * `EmptyState` (which itself dynamically imports `fake-indexeddb/auto` at
 * runtime, not eagerly) — so it is NOT part of either branch's eager
 * closure. That classification is structural, not branch-specific, so it
 * applies identically to `main`.
 *
 * ## Recalibrating the ceiling from `main`, not from this branch
 *
 * The ceiling must describe what an honest guard would have allowed on
 * `main` all along, plus this file's usual ~2.5-3 KB headroom — NOT be bent
 * to let this branch's already-measured overage through.
 *
 *   main_eager_closure = 338,350 B  (index-*.js was `main`'s only eager chunk;
 *                                    auto-*.js is dynamic, excluded above)
 *   CEILING_BYTES      = 338,350 + 3,000 = 341,350
 *
 * This branch's real eager closure measures **343,411 B** — **2,061 B over**
 * this recalibrated ceiling. That failure is expected and is the deliverable
 * of this change: the first honest measurement of L4's true eager cost. Do
 * not raise `CEILING_BYTES` to make it pass here; raising it is a decision
 * for whoever reviews L4's actual bundle growth, made in its own diff.
 *
 * ## History of the largest-single-asset ceiling (superseded above, kept for
 * the record)
 *
 * `278,028 B` was `main` before sub-project C (commit `652d3e5`). C's own
 * plan recorded an eager-loading estimate of `+23,216 B` (a spike measurement)
 * and this file originally carried a ceiling of `310_000` derived from it.
 * Both were wrong: four independent re-measurements during C's execution
 * (Task 2, Task 7 twice, and this task) found the real HEAD figure repeatedly
 * higher than the spike predicted, ending at a measured **`314,367 B`** —
 * a true delta of **`+36,339 B`**, 57% above the `+23,216` the eager decision
 * was originally made on. The `auto-*.js` chunk was excluded from that
 * reasoning entirely: it was byte-identical before and after C (it is
 * fake-indexeddb error strings), so none of its ~56 KB raw / ~15 KB gzip was
 * C's cost — the same chunk, and the same reasoning, that this rewrite now
 * excludes structurally via `dynamicImports` rather than by convention.
 *
 * The eager-loading decision itself still stands — it rested on a lazy
 * loader's silent-failure mode (a spike that compiled, ran, and highlighted
 * nothing), not on the byte count — but the byte count that decision was
 * described with was never right, four times over. See
 * `docs/superpowers/NEXT.md`'s C section for the full measurement history.
 *
 * The ceiling was a measured figure plus **roughly 2.5-3 KB of headroom** —
 * not a target, a limit. Raising it is a decision someone makes in a diff,
 * not a drift nobody notices.
 *
 * That margin was the PRACTICE, and it was written down here because the
 * rule this docblock used to state was "roughly 3%", which at that size would
 * have been ~10 KB. Nobody ever left 10 KB: the raises below left 89 B, 187 B
 * and 745 B before settling on ~2.5-3 KB deliberately. Carrying a stated rule
 * nobody follows alongside a practice nobody wrote down is how a ceiling
 * silently comes to have 89 bytes of room. A small margin is the right choice
 * — it forces each growth to be measured on both sides — but it has to be the
 * one on the page.
 *
 * Raised from 333,000 by B2 Task 4 (drag the level badge to move a section)
 * on 2026-08-29, measured on both sides as this file's convention requires:
 * the branch before this task was **332,255 B** — **745 bytes of headroom**,
 * the third ceiling in a row to be all but exhausted before anyone looked —
 * and the finished task measured **333,303 B**, a true cost of **1,048 B
 * gzipped** for the pointer state machine, the boundary measurement, the
 * auto-scroll loop and the two new decorations. No dependency was added, and
 * the CSS is not in this asset. Headroom was again ~2.7 KB, deliberately,
 * matching what K1 and M9b left.
 *
 * Raised from 328,000 by M9b (callout blocks) on 2026-08-27, measured on both
 * sides. `main` was **327,813 B** — **187 bytes of headroom**, so the previous
 * ceiling was even closer to exhausted than K1 left it — and the finished
 * milestone measured **330,243 B**, a true cost of **2,430 B gzipped** for the
 * marker grammar, the extended blockquote node, the `calloutTitle` node,
 * `sanitize`'s repair, the type command, the placeholder plugin, the chevron
 * menu and the input rule.
 *
 * An interim raise to 332,000 was made mid-milestone and described the cost as
 * 844 B, which was the figure at that moment and not the feature's. Both the
 * number and the ceiling were corrected rather than left to read as a final
 * measurement that was never taken.
 *
 * No dependency was added: `@tiptap/extension-blockquote` was already in the
 * bundle by way of StarterKit, so importing it directly was free. The five
 * icons cost nothing at all — they are `mask-image` data URIs in `tokens.css`,
 * which is CSS, not JS.
 *
 * Raised from 336,000 by L2 (backlinks: the `[[wikilink]]` grammar, the
 * `noteLinks` derived index, the link pill, the backlinks panel and `[[`
 * autocomplete) on 2026-08-31, measured on both sides per this file's
 * convention: `main` (`8987ae6`, L1 merged) was **334,590 B** gzipped, and the
 * finished branch measured **337,236 B** — a true cost of **2,646 B gzipped**
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
 * Raised from 324,000 by K1 (image capture) on 2026-08-26, with the growth
 * measured on both sides rather than estimated: `main` was **323,911** —
 * 89 bytes of headroom, so the previous ceiling was all but exhausted — and
 * the whole feature cost **1,555 B gzipped**: the downscaler, the stored-image
 * node and its view, the reference-counted object-URL cache, the paste plugin
 * and the path contract. No dependency was added; this was all first-party
 * code.
 *
 * Raised from 341,350 by L4 (the `⌘K` command palette) on 2026-08-31,
 * measured on both sides as this file's convention requires: `main`'s eager
 * closure was **338,350 B** (the guard-fix commit above re-measured it under
 * the manifest-walk method, unchanged from the largest-single-asset figure
 * because `main` still has only one eager chunk) and the finished branch
 * measures **343,411 B** (`themes-*` 230,427 + `index-*` 62,825 +
 * `EmptyState-*` 49,791 + `rolldown-runtime` 368) — a true eager cost of
 * **5,061 B**. `CEILING_BYTES` moves to 341,350 + 5,150 = 346,500, leaving
 * ~3,089 B of headroom, matching the ~2.5-3 KB this file has settled on.
 * This cost cannot be made lazy: it is ~28 translated strings across both
 * locales plus the shell wiring (`AppShell`'s `paletteBaseDeps`, `pending`
 * state and `ConfirmDialog` routing), and the `⌘K` shortcut listener and the
 * `CommandDeps` object it builds must exist before the palette chunk can be
 * asked to load at all — there is no boundary earlier than that to move
 * behind `React.lazy`. The palette's own chunk, `CommandPalette-*.js`, is
 * genuinely lazy and costs only 2,223 B, excluded from this closure exactly
 * as `dynamicImports` is meant to exclude it.
 *
 * ## FROZEN, as of 2026-08-31 — this ceiling no longer ratchets
 *
 * L2 and L4 were both shaped by this ceiling, and it had still never refused
 * anything: every sub-project since K1 raised it by its own measured cost.
 * Ruled before L5: **346,500 stays.** The measured eager closure is 343,411 B,
 * so 3,089 B remain, and that room is for wiring rather than for a feature.
 *
 * A change that would exceed it does NOT raise it. In order of preference:
 * move the code behind a `React.lazy` boundary (excluded from this closure by
 * construction, since `dynamicImports` is never followed); move the work to
 * the server, which already renders PDFs and stores images; or cut it.
 * Raising `CEILING_BYTES` is now an explicit decision the user makes, with the
 * reason recorded here — not a routine step in a sub-project. Both-sides
 * measurement is still required of anything touching the eager closure:
 * "we did not raise it" is only credible with a number on both sides.
 *
 * Scope, stated so it is not mistaken for coverage it does not have: this
 * guard sees eager JS only. The stylesheet (~30 KB gzipped) and the font
 * subsets are first-load bytes that nothing here measures.
 *
 * See `docs/rulings/testing-and-tooling.md` for the ruling itself.
 *
 * ### L5 (server-rendered Mermaid diagrams), measured both sides, 2026-09-01
 *
 * `main` (`190ecc7`, pre-L5) measures **343,415 B**. This branch measures
 * **346,045 B** — a true eager cost of **2,630 B**, leaving **455 B** of
 * headroom under the frozen 346,500 B ceiling. `CEILING_BYTES` does NOT
 * move; this is a record, not a request. The whole diagram feature —
 * `MermaidDiagram.ts`'s node view, `ensureDiagram`/`requestDiagram`, the
 * diagram cache repository, the export-time `collectDiagrams` pass and both
 * locales' failure sentences — ships for that cost because the actual
 * rendering happens server-side: no Mermaid, no layout engine and no theme
 * CSS reach the browser bundle at all. (22 B of the 2,630 is Task 9's own:
 * a pre-existing `StoredImage.ts` object-URL double-release race, exposed —
 * not caused — by this branch's extra editor plugin shifting initial-mount
 * timing, fixed alongside the verification work that found it; see
 * `e2e/imageSync.spec.ts` and the fix's own comment.) If a future change to
 * this feature needs more than ~455 B, the answer is the same as always: a
 * `React.lazy` boundary, server-side work, or a cut — not a raised ceiling.
 *
 * ### M (server-rendered publish dialog): the ceiling moves to 347,000,
 * decided by the user on 2026-09-01 — the escape hatch this freeze was
 * built to have, not the freeze being abandoned
 *
 * With the publish dialog wired in — `PublishDialog`, `PublishDialogContainer`
 * and `requestPublish.ts` all reached only through a THIRD `React.lazy`
 * boundary (`NoteEditor`'s `PublishDialogContainer`, alongside `GraphView`
 * and `CommandPalette`), plus the `ExportMenu` item and 9 collapsed i18n keys
 * that stay eager because the i18n dictionary is never chunked — the eager
 * closure measured **346,728 B**, against the previous **346,500 B**
 * ceiling: **228 B over**.
 *
 * Of that, only **~350 B is first-party feature code** (`ExportMenu.tsx`,
 * `RichEditor.tsx`, `NoteEditor.tsx` and the trimmed i18n dictionary,
 * measured directly off the eager chunks that hold them). The remaining
 * **~330 B is Rolldown re-chunking**, not a feature cost at all: adding a
 * THIRD independent `React.lazy` root changes the module graph's
 * reachability shape enough that Rolldown hoists shared code — React's own
 * runtime among it — into a new chunk that lands back in the eager closure,
 * regardless of what the third lazy chunk itself imports. This was proven,
 * not assumed: a control build that deleted the feature's only external
 * import (`requestPublish.ts`'s `API_ORIGIN`, replaced with a hardcoded
 * literal) still measured 346,734 B — the total moved by **under 6 B**.
 * Three real import strategies for that one dependency were also measured
 * (the `@/data` barrel: +1,286 B; a per-call dynamic `import()`: +661 B; a
 * direct static import of the leaf module, what shipped: +228 B) — the
 * spread across all four numbers (six B to 1,286 B) for the same feature
 * logic is itself the evidence that the overage is chunking noise, not
 * first-party weight. Inspecting the newly-extracted chunk's own bytes
 * confirmed it: its first kilobyte is React's `isMounted`/`enqueueSetState`
 * runtime, not application code.
 *
 * Chunk breakdown at the time of this raise:
 *   themes-*:      232,910 B
 *   index-*:        62,761 B
 *   EmptyState-*:   39,551 B
 *   config-*:       11,506 B   (the re-hoisted chunk — see above)
 *   total:         346,728 B
 *
 * `CEILING_BYTES` moves to **347,000**, leaving **272 B** of headroom at the
 * moment of this raise. The ceiling remains FROZEN under the same rule as
 * before: this raise does not reopen it to routine ratcheting. The next
 * feature that exceeds 347,000 goes lazier, moves to the server, gets cut,
 * or is put to the user — it does not raise the number itself. This raise
 * was decided BY THE USER, on the record above, not by sub-project M or by
 * whoever executed its tasks.
 *
 * **That 272 B is already stale, and this line records why rather than
 * silently re-editing the number above it.** Task 8's whole-branch review
 * found two small correctness fixes still needed after this raise shipped —
 * `handleUnpublish`'s missing `try`/`catch` and the CSP's missing
 * `form-action`/`base-uri`/`frame-ancestors` directives, both in this same
 * lazy chunk — which added roughly 40 B. The shipped closure, measured after
 * those fixes, is **346,767 B**, i.e. **233 B** of headroom under the same
 * frozen 347,000 ceiling. This branch was already bitten once by a stale
 * byte figure (a `+1,741 B` docblock estimate for `PublishDialog`'s focus
 * trap that measured 773 B in reality) — the number that matters to the
 * next person is what `npm run build` actually produces, not the number
 * recorded at whichever commit last touched this file. Re-run
 * `npx vitest run scripts/bundleSize.test.ts` after a build to get the
 * current figure; do not reason from either number above without doing so.
 */
const CEILING_BYTES = 347_000;

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

type Manifest = Record<string, ManifestChunk>;

describe('bundle size', () => {
  it('keeps the eager JS closure under its ceiling', () => {
    // Vitest sets `NODE_ENV=test` and `VITEST=true` on ITS OWN process, and
    // `execSync` inherits both into the child by default. Vite's build reads
    // `NODE_ENV` to pick its mode, so an inherited `test` value builds an
    // unminified, ~20% larger bundle (measured: 379,750 B gzipped instead of
    // 314,269 B) — a false failure with no code change behind it. Forcing
    // `production` here reproduces exactly what `npm run build` measures from
    // a plain shell.
    execSync('npm run build', { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });

    const manifestPath = 'dist/.vite/manifest.json';
    if (!existsSync(manifestPath)) {
      throw new Error(
        `${manifestPath} does not exist. This test reads the build manifest to find the ` +
          "entry chunk's transitive static-import closure; `build.manifest: true` must " +
          'stay enabled in vite.config.ts. Turning it off silently defangs this guard rather ' +
          'than failing it, which is exactly the "exists, unrun, silently stale" failure mode ' +
          'this repo treats as its worst state for a reference check.',
      );
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
    const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
    expect(
      entries.length,
      `expected exactly one entry chunk in ${manifestPath}, found ${entries.length}: ` +
        `${entries.map(([key]) => key).join(', ')}`,
    ).toBe(1);
    const [, entryChunk] = entries[0]!;

    // Walk STATIC `imports` transitively from the entry. `dynamicImports` is
    // deliberately never followed: that is the lazily-loaded code (e.g.
    // React.lazy boundaries) the ceiling exists to exclude.
    const closureFiles = new Set<string>();
    const visited = new Set<string>();
    const stack: ManifestChunk[] = [entryChunk];
    while (stack.length > 0) {
      const chunk = stack.pop()!;
      closureFiles.add(chunk.file);
      for (const importKey of chunk.imports ?? []) {
        if (visited.has(importKey)) continue;
        visited.add(importKey);
        const imported = manifest[importKey];
        if (imported) stack.push(imported);
      }
    }

    const sizes = [...closureFiles]
      .map((file) => ({ file, gzipped: gzipSync(readFileSync(`dist/${file}`)).length }))
      .sort((a, b) => b.gzipped - a.gzipped);
    const total = sizes.reduce((sum, { gzipped }) => sum + gzipped, 0);

    const breakdown = sizes.map(({ file, gzipped }) => `  ${file}: ${gzipped} B`).join('\n');
    expect(
      total,
      `eager JS closure is ${total} B gzipped, over the ${CEILING_BYTES} B ceiling:\n${breakdown}`,
    ).toBeLessThan(CEILING_BYTES);
  }, 30_000);
});
