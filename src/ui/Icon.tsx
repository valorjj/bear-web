import {
  ChevronDown,
  ChevronRight,
  GripHorizontal,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
} from 'lucide-react';
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
 * `Icon.test.tsx` renders each REAL lucide component listed below
 * through `@testing-library/react` — a dev/test dependency that never
 * reaches the shipped bundle — and asserts the whole rendered shape (every
 * child element's tag and attributes, in order) still matches these
 * constants, so a future `lucide-react` version bump that changes any glyph
 * fails a test instead of silently drawing the wrong shape.
 *
 * The entries are lucide's own `__iconNode` arrays, copied verbatim from
 * `node_modules/lucide-react/dist/esm/icons/*.mjs` minus their render `key`s.
 * A glyph is a LIST of shapes, not one path: `Heading6` draws its numeral
 * with a `<circle>`, and an earlier single-`d` registry could not have
 * represented it at all.
 */
type IconNode = readonly (readonly [tag: string, attrs: Readonly<Record<string, string>>])[];

const ICON_NODES = new Map<LucideIcon, IconNode>([
  [ChevronDown, [['path', { d: 'm6 9 6 6 6-6' }]]],
  [ChevronRight, [['path', { d: 'm9 18 6-6-6-6' }]]],
  // The table row handle's grip (`TableHandles.ts`) — a WIDE, short dot
  // cluster, matching the shape of the row it names. Replaced `Plus` when the
  // handle stopped inserting directly on click and started opening a menu: a
  // `+` that opens a menu instead of adding something is a lie the moment
  // it's clicked. See `docs/rulings/tables.md`.
  [
    GripHorizontal,
    [
      ['circle', { cx: '12', cy: '9', r: '1' }],
      ['circle', { cx: '19', cy: '9', r: '1' }],
      ['circle', { cx: '5', cy: '9', r: '1' }],
      ['circle', { cx: '12', cy: '15', r: '1' }],
      ['circle', { cx: '19', cy: '15', r: '1' }],
      ['circle', { cx: '5', cy: '15', r: '1' }],
    ],
  ],
  // The table column handle's grip, for the same reason above `GripHorizontal`
  // gives — a TALL, narrow dot cluster this time, matching the column it
  // names.
  [
    GripVertical,
    [
      ['circle', { cx: '9', cy: '12', r: '1' }],
      ['circle', { cx: '9', cy: '5', r: '1' }],
      ['circle', { cx: '9', cy: '19', r: '1' }],
      ['circle', { cx: '15', cy: '12', r: '1' }],
      ['circle', { cx: '15', cy: '5', r: '1' }],
      ['circle', { cx: '15', cy: '19', r: '1' }],
    ],
  ],
  // The six below draw the fold gutter's level indicator. Their shared first
  // three paths are the `H`; only the trailing numeral differs. `Heading6`
  // is the only entry that is not paths alone.
  [
    Heading1,
    [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'm17 12 3-2v8' }],
    ],
  ],
  [
    Heading2,
    [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1' }],
    ],
  ],
  [
    Heading3,
    [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2' }],
      ['path', { d: 'M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2' }],
    ],
  ],
  [
    Heading4,
    [
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M17 10v3a1 1 0 0 0 1 1h3' }],
      ['path', { d: 'M21 10v8' }],
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
    ],
  ],
  [
    Heading5,
    [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M17 13v-3h4' }],
      ['path', { d: 'M17 17.7c.4.2.8.3 1.3.3 1.5 0 2.7-1.1 2.7-2.5S19.8 13 18.3 13H17' }],
    ],
  ],
  [
    Heading6,
    [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['circle', { cx: '19', cy: '16', r: '2' }],
      ['path', { d: 'M20 10c-2 2-3 3.5-3 6' }],
    ],
  ],
]);

export function renderIconMarkup(glyph: LucideIcon, size: IconProps['size'] = 'md'): string {
  const shapes = ICON_NODES.get(glyph);
  if (shapes === undefined) {
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

  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) {
      el.setAttribute(name, value);
    }
    svg.appendChild(el);
  }

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
  Ban,
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
  Table as TableGlyph,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  UserRound,
  Pilcrow,
  Rows3,
  Columns3,
  GripHorizontal,
  GripVertical,
  LoaderCircle,
  Copy,
  ClipboardCopy,
  RotateCcw,
} from 'lucide-react';
