import type { TranslationKey } from '@/i18n';

import type { HighlightColor } from './Highlight';

export interface HighlightChoice {
  color: HighlightColor | null;
  label: TranslationKey;
  /**
   * The Tailwind utility for this swatch's fill. Written out rather than
   * interpolated from the colour name: Tailwind scans source text for whole
   * class names, so a `bg-hl-${color}` template would compile to nothing at
   * all — the same silent-no-output failure mode `--color-hover`'s two-
   * milestone absence had.
   */
  swatch: string;
}

/**
 * The one highlight roster, shared by the toolbar's colour menu, the palette
 * that floats at a highlight, and the context menu's swatch row. Three copies
 * of a colour list is three places for it to drift.
 */
export const HIGHLIGHT_CHOICES: readonly HighlightChoice[] = [
  // The default leads, because it is what every existing `==text==` already
  // is and the colours are the addition.
  { color: null, label: 'editor.highlight.default', swatch: 'bg-selected' },
  { color: 'blue', label: 'editor.highlight.blue', swatch: 'bg-hl-blue' },
  { color: 'green', label: 'editor.highlight.green', swatch: 'bg-hl-green' },
  { color: 'pink', label: 'editor.highlight.pink', swatch: 'bg-hl-pink' },
  { color: 'purple', label: 'editor.highlight.purple', swatch: 'bg-hl-purple' },
];
