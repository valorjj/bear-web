import type { Editor } from '@tiptap/react';
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

import { pinAllSelectionStep } from './toolbarSelection';

type Translate = (key: TranslationKey) => string;

export interface BottomToolbarProps {
  editor: Editor | null;
}

interface Action {
  key:
    | 'heading'
    | 'checklist'
    | 'bulletList'
    | 'orderedList'
    | 'bold'
    | 'italic'
    | 'strike'
    | 'highlight'
    | 'link'
    | 'code'
    | 'quote';
  label: TranslationKey;
  glyph: string;
  /**
   * `t` is threaded in rather than read from a hook because ACTIONS is a
   * module-level constant. The link action needs a translated prompt, and no
   * user-facing string may be hardcoded in a component.
   */
  run: (editor: Editor, t: Translate) => void;
  active: (editor: Editor) => boolean;
}

const ACTIONS: readonly Action[] = [
  {
    key: 'heading',
    label: 'editor.toolbar.heading',
    glyph: 'H',
    run: (editor) =>
      editor.chain().command(pinAllSelectionStep).focus().toggleHeading({ level: 1 }).run(),
    active: (editor) => editor.isActive('heading', { level: 1 }),
  },
  {
    key: 'checklist',
    label: 'editor.toolbar.checklist',
    glyph: '☑',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleTaskList().run(),
    active: (editor) => editor.isActive('taskList'),
  },
  {
    key: 'bulletList',
    label: 'editor.toolbar.bulletList',
    glyph: '•',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBulletList().run(),
    active: (editor) => editor.isActive('bulletList'),
  },
  {
    key: 'orderedList',
    label: 'editor.toolbar.orderedList',
    glyph: '1.',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive('orderedList'),
  },
  {
    key: 'bold',
    label: 'editor.toolbar.bold',
    glyph: 'B',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBold().run(),
    active: (editor) => editor.isActive('bold'),
  },
  {
    key: 'italic',
    label: 'editor.toolbar.italic',
    glyph: 'I',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleItalic().run(),
    active: (editor) => editor.isActive('italic'),
  },
  {
    key: 'strike',
    label: 'editor.toolbar.strike',
    glyph: 'S',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleStrike().run(),
    active: (editor) => editor.isActive('strike'),
  },
  {
    key: 'highlight',
    label: 'editor.toolbar.highlight',
    glyph: '▮',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleHighlight().run(),
    active: (editor) => editor.isActive('highlight'),
  },
  {
    key: 'link',
    label: 'editor.toolbar.link',
    glyph: '🔗',
    run: (editor, t) => {
      const href = window.prompt(t('editor.link.prompt'));
      if (href === null || href === '') {
        editor.chain().command(pinAllSelectionStep).focus().unsetLink().run();
        return;
      }
      editor
        .chain()
        .command(pinAllSelectionStep)
        .focus()
        .extendMarkRange('link')
        .setLink({ href })
        .run();
    },
    active: (editor) => editor.isActive('link'),
  },
  {
    key: 'code',
    label: 'editor.toolbar.code',
    glyph: '</>',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleCodeBlock().run(),
    active: (editor) => editor.isActive('codeBlock'),
  },
  {
    key: 'quote',
    label: 'editor.toolbar.quote',
    glyph: '❝',
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive('blockquote'),
  },
];

/**
 * Bear's floating bottom toolbar. Underline is deliberately absent: it has no
 * Markdown representation, and `_underline_` collides with CommonMark italic.
 */
export function BottomToolbar({ editor }: BottomToolbarProps): ReactElement {
  const t = useT();

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar.bottom')}
      className="flex h-9 shrink-0 items-center gap-1 border-t border-border bg-bg px-4"
    >
      {ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          aria-label={t(action.label)}
          aria-pressed={editor !== null && action.active(editor)}
          disabled={editor === null}
          onClick={() => editor !== null && action.run(editor, t)}
          className="h-7 rounded-sm px-2 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:bg-selected aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40"
        >
          {action.glyph}
        </button>
      ))}
    </div>
  );
}
