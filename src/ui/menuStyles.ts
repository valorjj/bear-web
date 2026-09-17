/**
 * The one floating-surface idiom, shared by every menu and panel in the app.
 *
 * These are plain Tailwind class strings, not a competing token system — the
 * point is that ten surfaces stop each spelling the same intent slightly
 * differently. Before this existed they disagreed on radius (`rounded-md` in
 * six, `rounded-lg` in four), on whether a border was drawn at all (four had
 * none, which reads as no edge at all in `high-contrast`, where
 * `--bear-shadow-popover` IS a 1px ring and nothing else), on row font
 * (`text-ui` in five, `text-ui-sm` in three), on row radius, and on whether
 * hover transitioned. None of that divergence was a decision; it accumulated
 * one menu at a time.
 *
 * What stays with the caller: position (`fixed`/`absolute` plus coordinates),
 * `z-index`, `min-width`, and `overflow`. Those genuinely differ per surface
 * — an anchored menu and a sidebar-footer popover cannot share a placement —
 * and a constant that guessed at them would just be overridden.
 *
 * PADDING is deliberately split across two constants rather than made an
 * override. `MENU_SURFACE` carries `p-1` and `PANEL_SURFACE` carries none, so
 * a panel wanting `p-2` ADDS one rather than fighting one: two padding
 * utilities in the same layer are resolved by stylesheet order, not by which
 * the element lists last, so "append `p-2` to override `p-1`" silently does
 * nothing. See `docs/rulings/design-tokens-and-layout.md` and `Pane`'s
 * `elevated` prop, which exists for exactly this reason.
 *
 * `bear-app-palette` is on the base, not just on `Popover`: a floating surface
 * paints in the APP palette wherever it is mounted, and without it one opened
 * from inside `.bear-sidebar-scope` inherits that container's re-mapped
 * tokens and resolves its borders and secondary text light-on-light. It is a
 * no-op outside the sidebar, which is why it costs nothing to apply
 * everywhere and why the surfaces that lack it are not visibly broken today —
 * `TagRowMenu` is the one opened from a tag row, and it only escapes because
 * `AppShell` mounts it at the root rather than inside the sidebar.
 */
const SURFACE = 'bear-app-palette bg-surface border-border shadow-popover rounded-lg border';

/** A menu: the surface plus the single 4px inset its rows sit in. */
export const MENU_SURFACE = `${SURFACE} p-1`;

/** A panel holding a form rather than rows; the caller supplies its padding. */
export const PANEL_SURFACE = SURFACE;

/**
 * A menu row, WITHOUT its resting colour. 26.8px tall at `text-ui`, which is
 * why menu touch targets grow `min-height` in `index.css` rather than an
 * overlay — a 44px overlay on a 26.8px row overlaps its neighbours, and a
 * near-miss then picks the wrong command.
 *
 * The colour is split off because three rows choose it at runtime
 * (`NoteRowMenu`'s danger rows, `ExportMenu`'s disabled ones) and a
 * conditional class CANNOT override one already in the base: both are
 * utilities in the same layer, so stylesheet order decides, not attribute
 * order. A row with a fixed colour uses `MENU_ITEM`; a row that computes one
 * composes it onto `MENU_ITEM_BASE` itself.
 */
export const MENU_ITEM_BASE =
  'ease-bear flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-ui transition-colors duration-[var(--bear-duration-fast)]';

/** A menu row in its ordinary resting colour. */
export const MENU_ITEM = `${MENU_ITEM_BASE} text-text hover:bg-hover`;

/** The same row, for an action that destroys something. */
export const MENU_ITEM_DESTRUCTIVE = `${MENU_ITEM_BASE} text-danger hover:bg-hover`;

/** The rule between two groups of rows, carrying the gap on its own margin. */
export const MENU_SEPARATOR = 'bg-border my-1 h-px';
