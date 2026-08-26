import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Gap kept between a menu and both the viewport's edges AND its anchor —
 * the literal `4` every one of the four call sites used before this was named.
 * Also what bounds `maxHeight`: a menu exactly `MENU_GAP` from top and bottom
 * can never be taller than `100vh - 2 * MENU_GAP`.
 */
export const MENU_GAP = 4;

/**
 * Everything focusable, NOT `'button'`.
 *
 * `ConfirmDialog`'s `'button'`-only trap is a documented gap, harmless there
 * only because it holds exactly two buttons — a trap that skips a focusable
 * does not hold focus at the surface's edge, it lets Tab walk out into the
 * page behind, where the user cannot see where focus went. See
 * `docs/rulings/accessibility.md`.
 */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface AnchoredMenu<E extends HTMLElement> {
  /** Attach to the menu's own element. Everything below reads through it. */
  ref: RefObject<E | null>;
  /** `position: fixed` coordinates. Anchored on first paint, corrected after measuring. */
  position: { top: number; left: number };
  /** Tab-trapping only — Escape is handled at the document level. */
  onKeyDown: (event: KeyboardEvent<E>) => void;
}

/**
 * The behaviour every floating menu in this app shares: anchored placement
 * that flips and clamps into the viewport, focus into the first item on open,
 * dismissal on Escape or an outside click, and a Tab trap.
 *
 * Extracted at the fourth copy. `HeadingMenu`, `EditorContextMenu`,
 * `TableHandleMenu` and `NoteRowMenu` had byte-identical versions of all four,
 * which meant four places to fix each of the non-obvious details recorded
 * below — every one of which was learned from a real failure.
 *
 * It lives in `src/lib/` rather than `src/ui/` because it is behaviour with no
 * markup and no product knowledge; per CLAUDE.md it must import nothing from
 * `src/app/`, `src/data/`, `src/features/` or `src/i18n/`, and it does not.
 *
 * @param rect     The anchor's viewport rectangle. A zero-size rect at the
 *                 pointer for a right-click open, or a real element rect for a
 *                 button open — both feed the flip/clamp with no special case.
 * @param onClose  Called on Escape or an outside mousedown.
 * @param remeasureOn
 *                 Extra dependencies for the measure-and-correct effect, for a
 *                 menu whose own height can change AFTER the first mount (a
 *                 conditional section arriving a render late). `rect` is always
 *                 a dependency; these are added to it.
 */
export function useAnchoredMenu<E extends HTMLElement>(
  rect: DOMRect,
  onClose: () => void,
  remeasureOn: readonly unknown[] = [],
): AnchoredMenu<E> {
  const ref = useRef<E | null>(null);
  const remeasureKey = remeasureOn.join('\u0000');

  // Anchored at the rect until proven otherwise. That rect is the only
  // geometry that exists before mount, so it is what the FIRST paint uses;
  // the effect below corrects it once the menu's own size exists.
  const [position, setPosition] = useState(() => ({
    top: rect.bottom + MENU_GAP,
    left: rect.left,
  }));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  // Flips above the anchor when there is no room below, and clamps
  // horizontally into the viewport. `fixed` positioning means scrolling can
  // never bring an off-screen menu back — and the places these menus open
  // (a heading in the bottom quarter of a long note, a right-click near the
  // window's edge) are the common case, not edge cases. Measured after mount,
  // in an effect: the menu's real height and width do not exist before the
  // first render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `getBoundingClientRect()` reads the RENDERED box, which a caller's own
    // `maxHeight` may already clamp — so this is the CONSTRAINED height, never
    // the natural one. That is deliberate: flipping and clamping against the
    // constrained height is what keeps `top + height` inside the viewport in
    // both branches, whereas against the natural height a menu too tall for
    // either placement would overflow whichever this picked.
    const menuRect = el.getBoundingClientRect();

    const fitsBelow = rect.bottom + MENU_GAP + menuRect.height <= window.innerHeight;
    const top = fitsBelow
      ? rect.bottom + MENU_GAP
      : Math.max(MENU_GAP, rect.top - MENU_GAP - menuRect.height);

    const left = Math.min(rect.left, window.innerWidth - menuRect.width - MENU_GAP);

    setPosition({ top, left: Math.max(MENU_GAP, left) });
    // `remeasureKey`, not `...remeasureOn`: a spread is a complex expression
    // the linter cannot check statically, and a caller passing a fresh array
    // literal every render would re-measure on every render. The joined
    // string changes exactly when one of the caller's values does.
  }, [rect, remeasureKey]);

  // Neither listener can live on the menu's own React handlers: both must keep
  // working after focus (or the click itself) has already left this subtree,
  // which is exactly the case a React handler scoped to this element can never
  // see. A click inside the editor, for instance, moves focus without the menu
  // ever receiving a keydown at all.
  useEffect(() => {
    function handleOutsideMouseDown(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    // Capture, not bubble. The control that opens a menu is frequently the
    // same kind of control that another open menu would treat as "outside",
    // and the openers here (`HeadingFold`'s badge, a table handle) attach
    // their own mousedown during the BUBBLE phase. Closing during CAPTURE
    // guarantees this runs first, so clicking heading B's badge while heading
    // A's menu is open closes A and only THEN lets the click open B — not the
    // reverse, which queues two state updates in one tick and leaves the new
    // menu closed instead of open.
    document.addEventListener('mousedown', handleOutsideMouseDown, true);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<E>): void {
    if (event.key !== 'Tab') return;

    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? index - 1 : index + 1;
    if (next < 0 || next >= items.length) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }

  return { ref, position, onKeyDown };
}
