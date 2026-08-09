import type { Editor } from '@tiptap/react';
import type { ReactElement } from 'react';

import { useT } from '@/i18n';

export interface TopControlsProps {
  editor: Editor | null;
  infoOpen: boolean;
  onToggleInfo: () => void;
}

/**
 * Bear duplicates Bold/Italic between a persistent top bar and a floating
 * bottom bar deliberately — the redundancy is a usability feature, not an
 * accident. Both toolbars carry a distinct `role="toolbar"` landmark with its
 * own accessible name so two identically-labelled "Bold" buttons remain
 * distinguishable to assistive tech and to `getByRole` lookups scoped with
 * `within(...)`.
 *
 * Underline still does not appear here (or in `BottomToolbar`): it has no
 * Markdown representation, and `_underline_` collides with CommonMark italic.
 */
export function TopControls({ editor, infoOpen, onToggleInfo }: TopControlsProps): ReactElement {
  const t = useT();

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar.top')}
      className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-4 py-2"
    >
      <button
        type="button"
        aria-label={t('editor.toolbar.bold')}
        aria-pressed={editor?.isActive('bold') ?? false}
        disabled={editor === null}
        onClick={() => editor?.chain().focus().toggleBold().run()}
        className="rounded px-2 py-1 text-xs font-bold text-muted hover:bg-hover aria-pressed:text-text"
      >
        B
      </button>
      <button
        type="button"
        aria-label={t('editor.toolbar.italic')}
        aria-pressed={editor?.isActive('italic') ?? false}
        disabled={editor === null}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        className="rounded px-2 py-1 text-xs italic text-muted hover:bg-hover aria-pressed:text-text"
      >
        I
      </button>
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
