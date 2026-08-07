export const SIDEBAR_WIDTH_KEY = 'pane.sidebarWidth';
export const NOTE_LIST_WIDTH_KEY = 'pane.noteListWidth';

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_NOTE_LIST_WIDTH = 320;

export const MIN_PANE_WIDTH = 160;
export const MAX_PANE_WIDTH = 560;

/** Keeps a pane usable regardless of what a drag, a stale setting, or a bad import supplies. */
export function clampPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, Math.round(width)));
}
