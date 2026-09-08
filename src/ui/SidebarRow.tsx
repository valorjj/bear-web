import { type ReactElement, type ReactNode, useMemo } from 'react';

import { type LongPressHandlers, useLongPress } from '@/lib/useLongPress';
import { ChevronRight, Icon } from '@/ui/Icon';

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
  /**
   * Sizes the row for a finger rather than a pointer: 44px tall with a 16px
   * label, against 32px and 13px.
   *
   * A prop rather than a media query inside this component, because
   * `src/ui/` holds presentation primitives that know nothing about the app's
   * layout modes — the caller decides, the same way `Resizer` takes `min`/`max`
   * rather than importing the pane-width constants.
   */
  touch?: boolean;
  /**
   * Opens the row's action menu — right-click, long-press, or `Shift+F10`
   * with the row focused. Receives the viewport rect to anchor against: a
   * zero-size rect at the pointer for a press, the row's own rect for the
   * keyboard route.
   *
   * A callback, so this primitive stays ignorant of tags, scopes and menus —
   * the same reason `disclosure` is a prop rather than a scope import.
   */
  onContextMenu?: (rect: DOMRect) => void;
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
  touch = false,
  onContextMenu,
}: SidebarRowProps): ReactElement {
  // `useLongPress` owns `contextmenu` as well as the touch timer, because the
  // two have to be deduplicated: Android Chrome raises `contextmenu` from a
  // long press at nearly the same moment the timer fires, and iOS Safari
  // raises none at all. `NoteListItem` learned this first.
  const longPress = useLongPress({
    onPress: (point) => onContextMenu?.(new DOMRect(point.x, point.y, 0, 0)),
  });
  // `SidebarRow` nests: `children` puts a descendant row's `<li>` inside this
  // one (the real tag tree does exactly this), and every native event
  // `useLongPress` listens for — `pointerdown`, `contextmenu` — bubbles. The
  // hook itself only calls `preventDefault` on `contextmenu`, never
  // `stopPropagation`, because `NoteListItem`'s rows are flat siblings and
  // have never needed it. Left alone here, a press on a leaf tag row would
  // also reach every ancestor's OWN `useLongPress` instance — each with its
  // own `firedAt` ref blind to the others — and fire twice. Stopping
  // propagation here, one row at a time, keeps that fix local to the caller
  // that has the problem rather than changing shared hook behaviour
  // `NoteListItem` also depends on.
  const pressHandlers = useMemo<Partial<LongPressHandlers>>(() => {
    if (onContextMenu === undefined) return {};
    const stop = <E extends { stopPropagation: () => void }>(
      handler: (event: E) => void,
    ): ((event: E) => void) => {
      return (event) => {
        // The hook's own handler runs first, so its dedupe window and press
        // timer still see the real event; stopping propagation only keeps
        // the event from also reaching an ancestor row's listeners.
        handler(event);
        event.stopPropagation();
      };
    };
    return {
      onPointerDown: stop(longPress.onPointerDown),
      onPointerMove: stop(longPress.onPointerMove),
      onPointerUp: stop(longPress.onPointerUp),
      onPointerCancel: stop(longPress.onPointerCancel),
      onContextMenu: stop(longPress.onContextMenu),
      // NOT wrapped in `stop()`, unlike every sibling above. Those five all
      // isolate ONE ROW'S OWN gesture recognition from a nested ancestor's —
      // pointer and contextmenu events genuinely bubble from a leaf tag row up
      // through every parent row's identical listeners, each blind to the
      // others' `firedAt` ref, and would otherwise double-fire. `onClickCapture`
      // has no such hazard: `longPress.onClickCapture` already only acts
      // (`preventDefault`/`stopPropagation`) when THIS row's own press just
      // fired (`suppressClick.current`), gated on this row's own ref — a
      // no-op the rest of the time. Wrapping it here called
      // `event.stopPropagation()` on EVERY click regardless of that gate,
      // which halts the DOM event before it ever reaches this row's own
      // `<button onClick={onSelect}>` (a capture-phase `stopPropagation`
      // stops the walk before the target/bubble phases run at all) — so
      // clicking any row wired with `onContextMenu` silently stopped
      // selecting it. Caught only once a caller finally passed
      // `onContextMenu` to a row that also needs `onSelect` to keep working;
      // `ui.test.tsx` had covered the menu opening but never a plain click
      // alongside it.
      onClickCapture: longPress.onClickCapture,
    };
  }, [longPress, onContextMenu]);

  return (
    <li {...pressHandlers} className={onContextMenu === undefined ? undefined : 'touch-press'}>
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
            <Icon
              glyph={ChevronRight}
              size="sm"
              className={`transition-transform duration-[var(--bear-duration-fast)] ${
                disclosure.expanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        )}

        <button
          type="button"
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key !== 'F10' || !event.shiftKey) return;
            event.preventDefault();
            onContextMenu?.(event.currentTarget.getBoundingClientRect());
          }}
          aria-current={selected ? current : undefined}
          aria-expanded={disclosure === undefined ? undefined : disclosure.expanded}
          style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
          // `h-8`, not M8's `h-6`. That 24 was measured against Bear's 22, and
          // Bear is no longer the authority: Soft Depth reads a row as a chip
          // rather than a line, and a chip needs room around its label. 32 is
          // on the permitted scale; 24 and 32 are both there, 28 is not.
          // `h-8`/13px on a pointer, `h-11`/16px on a finger. The 32 was
          // measured against Bear's desktop row; Bear's own PHONE rows are
          // ~44px with a 16px label, and at 32/13 the drawer read as a shrunken
          // desktop sidebar on an iPhone.
          className={`ease-bear relative flex min-w-0 flex-1 items-center rounded-md pr-2 text-left transition-colors duration-[var(--bear-duration-fast)] ${
            touch ? 'h-11 gap-3 text-ui-lg' : 'h-8 gap-2 text-ui'
          } ${selected ? 'bg-selected font-medium text-text' : 'text-text hover:bg-hover'}`}
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
