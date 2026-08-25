import type { ReactElement } from 'react';

export interface ProgressBarProps {
  /**
   * The busy region's accessible name. `src/ui/` may import nothing from
   * `src/i18n/` (enforced by `scripts/sourceLint.test.ts`), so the caller
   * resolves it through `useT` and passes the resolved string — the same
   * pattern `Resizer` uses for `min`/`max` instead of importing the pane
   * width constants.
   */
  label: string;
  /** Whether an export is in flight. The bar renders nothing otherwise. */
  active: boolean;
}

/**
 * A thin indeterminate bar fixed across the top of the window, shown only
 * while `active`. Non-blocking by construction: `fixed` + `pointer-events-none`
 * take it out of layout and out of the hit-testing path entirely, so the note
 * underneath stays fully readable and clickable while it renders.
 *
 * `role="progressbar"` with no `aria-valuenow` is the ARIA APG's indeterminate
 * form. A plain `aria-busy` container was the other option on the table and
 * was rejected: `progressbar` tells assistive tech directly "this is a
 * progress indicator", where a generic busy container leaves it to infer
 * that from context.
 *
 * Unmounting when `active` is false (rather than keeping it in the DOM at
 * opacity 0) stops the sweep animation from running while idle — the
 * dominant idle case, on a machine this project has been asked to keep cool.
 *
 * Reduced motion: the sweep is a CSS animation (`.bear-progress-bar` in
 * `tokens.css`) with its own `@media (prefers-reduced-motion: reduce)` rule
 * that disables it. What is left is a static bar whose mere appearance and
 * disappearance still carries the busy state.
 */
export function ProgressBar({ label, active }: ProgressBarProps): ReactElement | null {
  if (!active) return null;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="bear-progress-bar bg-accent h-full w-1/3" />
    </div>
  );
}
