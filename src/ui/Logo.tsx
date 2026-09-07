import type { ReactElement } from 'react';

export interface LogoProps {
  /** Rendered size in pixels, square. */
  size?: number;
  className?: string;
}

/**
 * The app's mark: a hash whose horizontals flow.
 *
 * `#` is the only glyph that means both things this app is — Markdown's
 * heading marker, and the organising primitive of a notes app filed by inline
 * hashtags rather than folders. The shallow wave is the name; a deeper one
 * turns to mush below about 20px.
 *
 * **Drawn in `currentColor`, never a literal.** `public/favicon.svg` carries
 * the same paths with hardcoded values because a favicon is fetched as a
 * standalone document and never sees this project's stylesheet — that file is
 * the sole permitted exception. Here the colour has to come from the cascade,
 * or the mark would stay indigo in all sixteen themes while everything around
 * it moved. Callers set it with a token utility (`text-accent`).
 *
 * `aria-hidden` by default: every current placement sits beside the wordmark
 * or inside a labelled region, so announcing it would only duplicate. A
 * caller that puts the mark somewhere it IS the only identification should
 * wrap it in an element carrying the name rather than reaching in here.
 *
 * It is a presentation primitive with no product knowledge, which is what
 * lets it live in `src/ui/` — see the architecture boundaries in CLAUDE.md.
 */
export function Logo({ size = 24, className = '' }: LogoProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M13 5 L10 27" />
      <path d="M23 5 L20 27" />
      <path d="M4 13.2 q6 -1.8 12 0 t12 0" />
      <path d="M3 20.8 q6 -1.8 12 0 t12 0" />
    </svg>
  );
}
