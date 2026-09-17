import { type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/i18n';
import { useAnchoredMenu } from '@/lib/useAnchoredMenu';
import { MENU_SURFACE } from '@/ui/menuStyles';

export interface ToolbarOverflowSheetProps {
  /** The `⋯` button that opened this, for placement and for dismissal. */
  anchor: { rect: DOMRect; opener: HTMLElement | null };
  onDismiss: () => void;
  /** The overflow controls, rendered by `BottomToolbar` itself. */
  children: ReactNode;
}

/**
 * The controls that do not fit the strip on a phone, in a grid four across.
 *
 * A GRID of the same icon buttons rather than a list of labelled rows, which
 * is the shape every other menu in this app uses. Two reasons. The icons are
 * the vocabulary the user already learned from the strip, so a list of words
 * would make them re-learn the same eight controls in a second notation; and
 * eight labelled rows is ~215px of a screen whose editor is only ~340px tall
 * once the keyboard is up, where two rows of four is 96px. The accessible
 * name is unchanged either way — each button keeps the `aria-label` it
 * carries in the strip, so nothing is lost to a screen reader by dropping the
 * visible text.
 *
 * It renders no buttons of its own: `BottomToolbar` passes them as children,
 * so the click handling, the `aria-pressed` wiring and the touch sizing have
 * exactly one definition. The alternative — this component importing the
 * actions table — would put `BottomToolbar` and this file in a cycle the
 * moment the strip needed to know which controls overflowed, and a runtime
 * import cycle here fails at MODULE INITIALISATION with every gate green.
 * See `src/features/editor/importCycle.test.ts`.
 *
 * `role="menu"` with the same `useAnchoredMenu` every other floating surface
 * uses, so Escape, the outside tap, the Tab trap and the flip-into-viewport
 * placement are the ones already shipped rather than a fourth copy.
 *
 * PORTALLED to `document.body`, and that is not tidiness. The toolbar's
 * wrapper in `RichEditor` takes a `transform` when the virtual keyboard is up
 * (J3), and a transformed ancestor becomes the containing block for
 * `position: fixed` — so the hook's carefully clamped viewport coordinates are
 * then applied against the toolbar's own box instead. Measured with a 336px
 * keyboard inset before the portal: the hook computed `top: 284px`, which is
 * correct against a visible bottom of 508, and the sheet RENDERED at 686 with
 * its right edge at 406 on a 390px screen — off the side of the phone, with
 * every number in the hook right. `CalloutMenu` and `LinkMenu` meet the same
 * trap and answer it by being rendered from `RichEditor`, outside that
 * wrapper. This one cannot: its children are the strip's own buttons, and
 * lifting the rendering would mean lifting the actions table with it and
 * giving `BottomToolbar` a second definition of every control. A portal moves
 * the DOM without moving the ownership.
 */
export function ToolbarOverflowSheet({
  anchor,
  onDismiss,
  children,
}: ToolbarOverflowSheetProps): ReactElement {
  const t = useT();
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(
    anchor.rect,
    onDismiss,
    [],
    // Without this the `⋯` button cannot close its own sheet: the hook's
    // capture listener closes on mousedown and the button's click re-opens.
    anchor.opener,
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('editor.toolbar.more')}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
      // A WRAPPED flex row at a width that seats four 44px controls, not a
      // `grid-cols-4`. Two reasons, both measured. A `fixed` box shrink-to-
      // fits, so `grid-cols-4`'s `minmax(0, 1fr)` columns resolved against a
      // 70px box and the buttons overlapped at a 16px pitch — visible only in
      // a real browser, since nothing in the unit suite has a layout engine.
      // And the highlight button and its colour chevron are ONE control: in a
      // grid they land in two cells with a gap between them, where wrapping
      // keeps them adjacent exactly as they are in the strip.
      className={`${MENU_SURFACE} fixed z-20 flex w-52 flex-wrap gap-1`}
    >
      {children}
    </div>,
    document.body,
  );
}
