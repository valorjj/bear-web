import type { Editor } from '@tiptap/react';
import type { ReactElement } from 'react';

import { useT } from '@/i18n';

export interface TopControlsProps {
  editor: Editor | null;
  infoOpen: boolean;
  onToggleInfo: () => void;
}

/**
 * Bold and Italic deliberately do not appear here: `BottomToolbar` already
 * has buttons with those exact accessible names, and rendering both at once
 * would give the DOM two buttons named "Bold" — breaking every test (and
 * every user) that looks one up by name. `editor` is accepted for parity
 * with the other toolbar components and future top-bar actions, but is not
 * yet used.
 */
export function TopControls({ infoOpen, onToggleInfo }: TopControlsProps): ReactElement {
  const t = useT();

  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-4 py-2">
      <button
        type="button"
        aria-label={t('editor.info.show')}
        aria-expanded={infoOpen}
        onClick={onToggleInfo}
        className="rounded px-2 py-1 text-xs text-muted hover:bg-hover"
      >
        ⓘ
      </button>
    </div>
  );
}
