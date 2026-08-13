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
 * Glyph components the app uses, re-exported so feature code never imports
 * `lucide-react` directly. `scripts/sourceLint.test.ts` enforces this file as
 * the only importer of the package; a feature file needing a new glyph adds
 * it here, not at its own call site.
 */
export {
  FileText,
  Inbox,
  ListTodo,
  Calendar,
  Pin,
  PinOff,
  Lock,
  Trash2,
  Hash,
  ChevronRight,
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
} from 'lucide-react';
