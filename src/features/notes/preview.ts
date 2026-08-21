/** Row density. `large` is the row the app shipped with from M3 to M9a. */
export type PreviewSize = 'small' | 'medium' | 'large';

/** Smallest first — the order the menu lists them in. */
export const PREVIEW_SIZES: readonly PreviewSize[] = ['small', 'medium', 'large'];

export const DEFAULT_PREVIEW_SIZE: PreviewSize = 'large';

export function isPreviewSize(value: unknown): value is PreviewSize {
  return typeof value === 'string' && (PREVIEW_SIZES as readonly string[]).includes(value);
}

/**
 * How many lines of snippet a size shows. Drives BOTH the rendered row and its
 * accessible name, from this one decision — the label must never announce a
 * snippet the row does not display.
 */
export function snippetLines(size: PreviewSize): 0 | 1 | 2 {
  switch (size) {
    case 'small':
      return 0;
    case 'medium':
      return 1;
    case 'large':
      return 2;
  }
}
