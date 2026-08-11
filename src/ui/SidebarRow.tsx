import type { ReactElement, ReactNode } from 'react';

export interface SidebarRowDisclosure {
  expanded: boolean;
  onToggle: () => void;
  /** Accessible name, already translated by the caller. */
  label: string;
}

export interface SidebarRowProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** Nesting level; each level indents. */
  depth?: number;
  /** Trailing count. Omit to render none. Zero renders as "0". */
  count?: number;
  /** Leading glyph or icon. */
  icon?: ReactNode;
  /** Omit for a leaf row; a spacer keeps labels aligned with siblings. */
  disclosure?: SidebarRowDisclosure;
  /** `aria-current` value when selected. */
  current?: 'page' | 'true';
  /** Nested rows, rendered inside this row's `<li>`. */
  children?: ReactNode;
}

const INDENT_REM = 0.75;

/**
 * One row of the sidebar: the shared shape behind the tag tree, M6's smart
 * lists, and M7's search results. Pure presentation — it knows nothing about
 * scopes, tags, or notes, which is what lets it live in `src/ui/`.
 *
 * Renders an `<li>` and expects a `<ul>` parent.
 */
export function SidebarRow({
  label,
  selected,
  onSelect,
  depth = 0,
  count,
  icon,
  disclosure,
  current = 'page',
  children,
}: SidebarRowProps): ReactElement {
  return (
    <li>
      <div className="flex items-center gap-1">
        {disclosure === undefined ? (
          // A spacer, not nothing: without it a leaf row's label sits one
          // control-width left of its siblings' labels.
          <span className="w-4 shrink-0" aria-hidden="true" />
        ) : (
          <button
            type="button"
            aria-label={disclosure.label}
            onClick={disclosure.onToggle}
            className="w-4 shrink-0 rounded-sm text-ui-xs text-faint transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-text"
          >
            {disclosure.expanded ? '▾' : '▸'}
          </button>
        )}

        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? current : undefined}
          aria-expanded={disclosure === undefined ? undefined : disclosure.expanded}
          style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
          className={`relative flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm pr-2 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
            selected ? 'bg-selected font-medium text-text' : 'text-text hover:bg-hover'
          }`}
        >
          {/*
            The accent edge marker. With the tinted `bg-selected` fill this is
            what makes selection read as MORE present than its surroundings —
            before M5.5 a selected row was `bg-bg`, i.e. a hole.
          */}
          {selected && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
            />
          )}

          {icon !== undefined && (
            <span aria-hidden="true" className="shrink-0 text-faint">
              {icon}
            </span>
          )}

          <span className="min-w-0 flex-1 truncate">{label}</span>

          {count !== undefined && (
            <>
              {/*
                An explicit space text node, not a CSS gap. Accessible-name
                computation concatenates text content and ignores `gap-2`, so
                without this a row announces as "work3" rather than "work 3".
                The pre-M5.5 TagSidebar had this space; losing it in the move
                to SidebarRow was a silent screen-reader regression.
              */}{' '}
              <span data-count className="shrink-0 text-ui-xs text-faint tabular-nums">
                {count}
              </span>
            </>
          )}
        </button>
      </div>

      {children}
    </li>
  );
}
