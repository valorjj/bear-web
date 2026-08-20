import type { Editor } from '@tiptap/react';
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { Bold, Download, Icon, Info, Italic } from '@/ui/Icon';

import { pinAllSelectionStep } from './toolbarSelection';

export interface TopControlsProps {
  editor: Editor | null;
  infoOpen: boolean;
  onToggleInfo: () => void;
  /** Omit to render no export control at all — see `RichEditor`. */
  exportOpen?: boolean;
  onToggleExport?: () => void;
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
 *
 * Shaped as a FLOATING PILL, positioned by its parent rather than by itself:
 * `RichEditor` owns the `absolute` placement so this component stays a bare
 * group of controls and the two toolbars cannot drift apart on where "floating"
 * puts them. Measured against Bear, a full-width bar welded to the pane edge is
 * the single largest reason this editor read as a web page rather than an app —
 * see `docs/design/DESIGN-bear-web.md`.
 */
export function TopControls({
  editor,
  infoOpen,
  onToggleInfo,
  exportOpen,
  onToggleExport,
}: TopControlsProps): ReactElement {
  const t = useT();

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar.top')}
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-full bg-surface px-2 shadow-popover"
    >
      <button
        type="button"
        aria-label={t('editor.toolbar.bold')}
        aria-pressed={editor?.isActive('bold') ?? false}
        disabled={editor === null}
        onClick={() => editor?.chain().command(pinAllSelectionStep).focus().toggleBold().run()}
        className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon glyph={Bold} />
      </button>
      <button
        type="button"
        aria-label={t('editor.toolbar.italic')}
        aria-pressed={editor?.isActive('italic') ?? false}
        disabled={editor === null}
        onClick={() => editor?.chain().command(pinAllSelectionStep).focus().toggleItalic().run()}
        className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon glyph={Italic} />
      </button>
      {onToggleExport !== undefined && (
        <button
          type="button"
          aria-label={t('export.open')}
          aria-haspopup="menu"
          aria-expanded={exportOpen ?? false}
          onClick={onToggleExport}
          className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-expanded:text-text"
        >
          <Icon glyph={Download} />
        </button>
      )}
      <button
        type="button"
        aria-label={t('editor.info.show')}
        aria-expanded={infoOpen}
        onClick={onToggleInfo}
        className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover"
      >
        <Icon glyph={Info} />
      </button>
    </div>
  );
}
