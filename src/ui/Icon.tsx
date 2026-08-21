import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

export interface IconProps {
  glyph: LucideIcon;
  /** `sm` is for dense trailing positions; `md` is everything else. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The only door to `lucide-react` — enforced by `scripts/sourceLint.test.ts`.
 *
 * It exists to make three rules unbreakable rather than merely written down:
 * one stroke width across every glyph, two sizes and no more, and
 * `aria-hidden` on every icon in the app. An icon that is not hidden joins the
 * accessible name of the control wrapping it, which is how a "Delete forever"
 * button starts announcing as "Delete forever trash".
 *
 * Size and stroke live here as numbers rather than CSS tokens because lucide
 * takes them as props; this component IS the single source of truth for them.
 */
const SIZES = { sm: 14, md: 16 } as const;

/**
 * The ONE stroke width, shared by `Icon` and `renderIconMarkup` below —
 * hoisted so "one stroke width across every glyph" (the docblock above)
 * cannot silently become two constants that drift apart. Before this, the
 * same `1.75` was written as a literal in both places with nothing to
 * assert they agreed.
 */
const STROKE_WIDTH = 1.75;

export function Icon({ glyph: Glyph, size = 'md', className = '' }: IconProps): ReactElement {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={SIZES[size]}
      strokeWidth={STROKE_WIDTH}
      className={`shrink-0 ${className}`}
    />
  );
}

/**
 * Path data for the two glyphs `renderIconMarkup` below ever renders, copied
 * VERBATIM from `lucide-react`'s own modules
 * (`node_modules/lucide-react/dist/esm/icons/chevron-{down,right}.mjs`,
 * pinned at the version in `package.json`).
 *
 * This trade — a version-pinned duplicate of two `d` strings, rather than
 * calling lucide's own components — was made after measuring the
 * alternative: an earlier version of `renderIconMarkup` called
 * `renderToStaticMarkup` (`react-dom/server`) on a real `<Icon>` element.
 * That worked, but `react-dom/server` is a genuinely separate module from
 * the `react-dom` the app already ships (its own reconciler-free renderer),
 * and `Icon.tsx` is imported by every screen — so it shipped to every user
 * for exactly two 24x24 path strings. Measured with `npm run build`,
 * comparing the shipped bundle with and without the import: **+187.89 kB
 * raw / +57.20 kB gzip** (855.77 kB / 268.98 kB without, 1043.66 kB /
 * 326.18 kB with). That is more than 2x the project's existing >500 kB
 * chunk-size warning on its own, for a feature that draws two chevrons —
 * clearly material, not a rounding error.
 *
 * Calling lucide's OWN components directly to avoid the duplication (e.g.
 * invoking their `forwardRef` render function without React) is not viable
 * either: `lucide-react`'s base `Icon` component
 * (`node_modules/lucide-react/dist/esm/Icon.mjs`) calls `useLucideContext()`,
 * a React Context hook, and hooks only work inside an active React render
 * pass — there is no standalone way to invoke it without a real renderer,
 * which is exactly the weight this whole function exists to avoid.
 *
 * The duplication is checked, not merely hoped to stay correct:
 * `Icon.test.tsx` renders the REAL `ChevronDown`/`ChevronRight` components
 * through `@testing-library/react` — a dev/test dependency that never
 * reaches the shipped bundle — and asserts their rendered `d` attribute
 * still matches these constants, so a future `lucide-react` version bump
 * that changes either glyph's path fails a test instead of silently
 * drawing the wrong shape.
 */
const CHEVRON_PATHS = new Map<LucideIcon, string>([
  [ChevronDown, 'm6 9 6 6 6-6'],
  [ChevronRight, 'm9 18 6-6-6-6'],
]);

/**
 * Renders a glyph to a static SVG markup string, for the one place in the app
 * that needs an icon OUTSIDE React's tree: `HeadingFold.ts`'s widget builders
 * are plain DOM (ProseMirror decorations, not React), so they cannot render
 * `<Icon />` directly. Builds the `<svg>` element with `document.createElementNS`
 * rather than going through any React renderer — see `CHEVRON_PATHS` above for
 * why. Restricted to the glyphs actually needed here; a glyph with no entry
 * throws rather than silently rendering nothing, so a future call site adding
 * a third glyph fails loudly instead of shipping an invisible button.
 */
export function renderIconMarkup(glyph: LucideIcon, size: IconProps['size'] = 'md'): string {
  const d = CHEVRON_PATHS.get(glyph);
  if (d === undefined) {
    throw new Error('renderIconMarkup: no path data registered for this glyph');
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(SIZES[size]));
  svg.setAttribute('height', String(SIZES[size]));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(STROKE_WIDTH));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'shrink-0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);

  return svg.outerHTML;
}

/**
 * Glyph components the app uses, re-exported so feature code never imports
 * `lucide-react` directly. `scripts/sourceLint.test.ts` enforces this file as
 * the only importer of the package; a feature file needing a new glyph adds
 * it here, not at its own call site.
 */
export type { LucideIcon };

export {
  FileText,
  Inbox,
  ListTodo,
  Calendar,
  Pin,
  Lock,
  Trash2,
  Hash,
  ChevronRight,
  ChevronDown,
  SquarePen,
  Search,
  X,
  Heading,
  List,
  ListOrdered,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Link,
  Code,
  Quote,
  Info,
  Palette,
  Download,
  FileCode,
  Printer,
  Table as TableGlyph,
  UserRound,
} from 'lucide-react';
