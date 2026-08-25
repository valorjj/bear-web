import { type ReactElement, useEffect } from 'react';

import { useT } from '@/i18n';
import { Ban, Icon } from '@/ui/Icon';

import type { HighlightColor } from './Highlight';
import { HIGHLIGHT_CHOICES } from './highlightChoices';

/**
 * Three outcomes, and the middle one is the easy mistake.
 *
 * A `HighlightColor` sets that colour. `null` sets the DEFAULT tint — the
 * uncoloured `==text==` mark, which `Highlight.ts` deliberately represents as
 * `color: null` rather than as a sixth roster entry. `'remove'` unsets the
 * mark entirely. Collapsing `null` and `'remove'` would make the remove
 * control paint grey instead of clearing.
 */
export type HighlightChoiceResult = HighlightColor | null | 'remove';

export interface HighlightPaletteProps {
  /** The colour of the highlight under the caret; `null` is the default tint. */
  current: HighlightColor | null;
  onChoose: (result: HighlightChoiceResult) => void;
  /** Escape. Placement and outside-click dismissal are the caller's. */
  onDismiss: () => void;
}

/**
 * The highlight colours as a horizontal swatch row, floated at the highlight
 * the caret is inside.
 *
 * Distinct from `HighlightMenu`, which is the vertical labelled menu under the
 * toolbar's colour chevron: this one is reached by pointing at the text, is
 * icon-dense, and carries a remove control the menu deliberately does not
 * (`HighlightMenu`'s five choices all SET, so none of them can clear).
 *
 * `menuitemradio` for the same reason `HighlightMenu` uses it: the choices are
 * mutually exclusive and one is always in effect, which is what `aria-checked`
 * means. Remove is a plain `button` because it is not one of the alternatives —
 * it leaves the set entirely.
 *
 * This component does NOT position itself; `RichEditor` owns placement, the
 * same division `TopControls` and `BottomToolbar` already keep.
 */
export function HighlightPalette({
  current,
  onChoose,
  onDismiss,
}: HighlightPaletteProps): ReactElement {
  const t = useT();

  // On `window`, not a React `onKeyDown`: the caret is in the editor, not in
  // this palette, so a handler bound to this subtree would never fire. Same
  // reasoning as `HighlightMenu`'s own Escape listener.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="menu"
      aria-label={t('editor.highlight.palette')}
      className="flex items-center gap-1 rounded-full bg-surface px-2 py-1 shadow-popover"
    >
      {HIGHLIGHT_CHOICES.map((choice) => (
        <button
          key={choice.color ?? 'default'}
          type="button"
          role="menuitemradio"
          aria-checked={choice.color === current}
          aria-label={t(choice.label)}
          // `onMouseDown` with `preventDefault` would be wrong here: the
          // caret must STAY in the highlight, and it does — the editor keeps
          // its selection across a click on chrome outside it, which is what
          // every existing toolbar button relies on.
          onClick={() => onChoose(choice.color)}
          className={`size-5 shrink-0 rounded-full border border-border transition-[outline] duration-[var(--bear-duration-fast)] ease-bear aria-checked:outline-2 aria-checked:outline-offset-2 aria-checked:outline-accent ${choice.swatch}`}
        />
      ))}
      <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <button
        type="button"
        aria-label={t('editor.highlight.remove')}
        onClick={() => onChoose('remove')}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover hover:text-text"
      >
        <Icon glyph={Ban} size="sm" />
      </button>
    </div>
  );
}
