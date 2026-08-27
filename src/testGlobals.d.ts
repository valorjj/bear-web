/**
 * Globals that `vitest.setup.ts` installs, declared for the `app` tsconfig
 * project.
 *
 * The declaration cannot live beside the implementation. `vitest.setup.ts`
 * belongs to the `node` project — deliberately, so Node globals stay out of
 * browser code (CLAUDE.md) — and a `declare global` there is invisible to
 * everything under `src/`, which the `app` project owns. The consequence is
 * not obvious and cost a build: `vitest run` does not typecheck, so a test
 * using an undeclared global passes locally and fails only in `npm run build`,
 * where `tsc -b` compiles `src/**` including its test files.
 */
declare global {
  /**
   * Sets the width `matchMedia` answers against, and notifies every listener.
   * Reset to 1280 — desktop — after each test.
   */
  var __setViewportWidth: (width: number) => void;
  /**
   * Sets whether `matchMedia` answers `true` to `(pointer: coarse)` and
   * `(hover: none)`, and notifies every listener. Reset to `false` — a mouse —
   * after each test.
   */
  var __setPointerCoarse: (coarse: boolean) => void;
}

export {};
