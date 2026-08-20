import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

export function Icon({ glyph: Glyph, size = 'md', className = '' }: IconProps): ReactElement {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={SIZES[size]}
      strokeWidth={1.75}
      className={`shrink-0 ${className}`}
    />
  );
}

/**
 * Renders a glyph to a static SVG markup string, for the one place in the app
 * that needs an icon OUTSIDE React's tree: `HeadingFold.ts`'s widget builders
 * are plain DOM (ProseMirror decorations, not React), so they cannot render
 * `<Icon />` directly. This keeps `Icon.tsx` the single source of truth for
 * every glyph's markup — stroke width, size, `aria-hidden` — even there,
 * rather than a second call site hand-copying path data from lucide.
 */
export function renderIconMarkup(glyph: LucideIcon, size: IconProps['size'] = 'md'): string {
  return renderToStaticMarkup(<Icon glyph={glyph} size={size} />);
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
} from 'lucide-react';
