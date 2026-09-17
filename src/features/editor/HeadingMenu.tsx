import { isMacOS } from '@tiptap/core';
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { useAnchoredMenu } from '@/lib/useAnchoredMenu';

import type { HeadingMenuRequest } from './HeadingFold';

import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '@/ui/menuStyles';

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

export interface HeadingMenuProps {
  request: HeadingMenuRequest;
  onSetLevel: (level: number) => void;
  onToggleFold: () => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
  onClose: () => void;
}

/**
 * The level menu on a heading's fold badge.
 *
 * Rendered by the app, never by the plugin: the editor deliberately learns
 * nothing about app concerns, the same boundary `TagPill`/`onActivateTag`
 * keeps. The plugin reports where the badge is; React draws the menu.
 *
 * The shortcut hint says `Mod-Alt-N` because that is what
 * `@tiptap/extension-heading` already binds. It is NOT Bear's `Cmd-N`:
 * browsers own `Cmd-1`..`Cmd-9` for tab switching and a page cannot
 * `preventDefault` it, so those keys are unavailable to this app at any price.
 */
export function HeadingMenu({
  request,
  onSetLevel,
  onToggleFold,
  onFoldAll,
  onUnfoldAll,
  onClose,
}: HeadingMenuProps): ReactElement {
  const t = useT();
  const modifier = isMacOS() ? '⌘⌥' : 'Ctrl+Alt+';

  // Placement, initial focus, Escape/outside dismissal and the Tab trap all
  // come from `useAnchoredMenu` — four behaviours this file, `EditorContextMenu`,
  // `TableHandleMenu` and `NoteRowMenu` each had a byte-identical copy of.
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('editor.fold.level')}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
      className={`${MENU_SURFACE} fixed z-20 min-w-48`}
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="menuitemradio"
          aria-checked={level === request.level}
          onClick={() => {
            // Choosing the level a heading already has is a no-op, not a
            // toggle: the check mark is radio semantics and toggling from it
            // would contradict the mark. The keyboard shortcut still toggles,
            // which is pre-existing upstream behaviour left deliberately alone.
            if (level !== request.level) onSetLevel(level);
            onClose();
          }}
          className={`${MENU_ITEM} justify-between`}
        >
          <span>
            {t('editor.fold.headingLevel')} {level}
          </span>
          <span className="text-faint">{`${modifier}${level}`}</span>
        </button>
      ))}

      <div className={MENU_SEPARATOR} role="separator" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggleFold();
          onClose();
        }}
        className={MENU_ITEM}
      >
        {t('editor.fold.toggle')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onFoldAll();
          onClose();
        }}
        className={MENU_ITEM}
      >
        {t('editor.fold.foldAll')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onUnfoldAll();
          onClose();
        }}
        className={MENU_ITEM}
      >
        {t('editor.fold.unfoldAll')}
      </button>
    </div>
  );
}
