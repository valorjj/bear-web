import { type ReactElement, useEffect, useRef } from 'react';

import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';
import { useAnchoredMenu } from '@/lib/useAnchoredMenu';

import { CALLOUT_TYPES, type CalloutType } from './callouts';

export interface CalloutMenuProps {
  /** The type under the cursor; `null` is a plain quote. */
  current: CalloutType | null;
  /** The toolbar button this menu belongs to — its rect and its element. */
  anchor: { rect: DOMRect; opener: HTMLElement | null };
  onChoose: (type: CalloutType | null) => void;
  /** Closes without choosing — Escape, or a click elsewhere. */
  onDismiss: () => void;
}

/**
 * The six choices: a plain quote, then the roster in `callouts.ts`'s order.
 *
 * Derived from `CALLOUT_TYPES` rather than listed again, so a sixth type
 * cannot appear in the schema and be missing from the menu. The label keys are
 * asserted to exist by `TranslationKey`, which is what makes a forgotten
 * translation a compile error rather than a blank row.
 */
const CHOICES: ReadonlyArray<{ type: CalloutType | null; label: TranslationKey }> = [
  { type: null, label: 'editor.callout.plain' },
  ...CALLOUT_TYPES.map((type) => ({
    type,
    label: `editor.callout.${type}` as TranslationKey,
  })),
];

/**
 * The callout types, as a menu anchored to the toolbar's callout button.
 *
 * ANCHORED since the button replaced M9b's quote-plus-chevron pair. Until then
 * this rendered as a centred child of a flex column above the toolbar, so a
 * menu opened from the strip's right-hand end floated over the middle of the
 * pane with nothing connecting it to the control that opened it — the user's
 * report was "its location is not right at all", and a card that points at
 * nothing is exactly what that describes. `useAnchoredMenu` is the same
 * placement, focus, dismissal and Tab-trap behaviour `HeadingMenu`,
 * `EditorContextMenu`, `TableHandleMenu` and `NoteRowMenu` share; it flips
 * above the button, which here is always, since the toolbar floats at the
 * bottom of the pane.
 *
 * It must render OUTSIDE the toolbar's own positioned wrapper. That wrapper
 * takes a `transform` when the virtual keyboard is up (J3), and a transformed
 * ancestor becomes the containing block for `position: fixed` — the menu would
 * then be anchored to the toolbar rather than to the viewport, and the
 * hook's viewport clamp would be measuring the wrong box.
 *
 * `menuitemradio` rather than `menuitem`, on the same reasoning as
 * `HighlightMenu`: the choices are mutually exclusive and exactly one is
 * always in effect, which is what `aria-checked` carries. The swatch and the
 * icon alone would leave a screen-reader user with six identically-shaped
 * buttons.
 *
 * Focus moves to the checked item on open — the hook focuses the first
 * focusable in its own effect, and this component's effect runs after it and
 * wins — because the control that opens this is icon-only: a keyboard user who
 * cannot get in has no route to a callout at all.
 */
export function CalloutMenu({
  current,
  anchor,
  onChoose,
  onDismiss,
}: CalloutMenuProps): ReactElement {
  const t = useT();
  const checked = useRef<HTMLButtonElement | null>(null);

  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(
    anchor.rect,
    onDismiss,
    [],
    // Without this the button could not close its own menu: the hook's capture
    // listener closes on mousedown and the button's click re-opens.
    anchor.opener,
  );

  useEffect(() => {
    checked.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('editor.callout.menu')}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
      className="bg-surface shadow-popover fixed z-20 flex min-w-36 flex-col gap-0.5 rounded-lg p-1"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice.type ?? 'plain'}
          ref={choice.type === current ? checked : undefined}
          type="button"
          role="menuitemradio"
          aria-checked={choice.type === current}
          onClick={() => onChoose(choice.type)}
          className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-ui text-text transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-checked:bg-selected"
        >
          {/*
            The same glyph the block itself draws, from the same tokens — a
            mask over the type's edge hue, keyed by `data-type` in
            `editor.css`. NOT an interpolated Tailwind class and not an inline
            style: Tailwind scans source text for whole class names, so a
            `bg-cal-${type}` template compiles to nothing at all — the silent
            no-output failure `--color-hover` had for two milestones. The same
            trap `HIGHLIGHT_CHOICES` writes its swatches out longhand to avoid.
          */}
          <span aria-hidden="true" className="bear-cal-swatch" data-type={choice.type ?? 'plain'} />
          {t(choice.label)}
        </button>
      ))}
    </div>
  );
}
