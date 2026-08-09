import { EditorContent, type Editor, useEditor } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect, useState } from 'react';

import { BottomToolbar } from './BottomToolbar';
import { editorExtensions } from './extensions';
import { InfoPanel } from './InfoPanel';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { TopControls } from './TopControls';

export interface RichEditorHandle {
  getMarkdown: () => string;
  editor: Editor | null;
}

export interface RichEditorProps {
  /** Read once, at mount. This component is expected to be keyed by note id. */
  initialMarkdown: string;
  onChange: () => void;
  onBlur: () => void;
  ariaLabel: string;
  handleRef: RefObject<RichEditorHandle | null>;
  /** Displayed by the info panel. */
  createdAt: number;
  updatedAt: number;
}

/**
 * The Tiptap instance. Uncontrolled by design: ProseMirror owns the document,
 * and the caller pulls Markdown out through `handleRef` when it needs to save.
 *
 * Pushing a `value` prop in would fight ProseMirror for ownership and move the
 * caret on every write.
 */
export function RichEditor({
  initialMarkdown,
  onChange,
  onBlur,
  ariaLabel,
  handleRef,
  createdAt,
  updatedAt,
}: RichEditorProps): ReactElement {
  const [infoOpen, setInfoOpen] = useState(false);
  const editor = useEditor({
    extensions: editorExtensions,
    content: parseMarkdown(initialMarkdown),
    onUpdate: onChange,
    onBlur,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        class: 'min-h-0 flex-1 bg-bg px-6 py-4 text-sm text-text outline-none',
      },
    },
  });

  useEffect(() => {
    handleRef.current = {
      getMarkdown: () => (editor === null ? initialMarkdown : serializeMarkdown(editor.getJSON())),
      editor,
    };

    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef, initialMarkdown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopControls
        editor={editor}
        infoOpen={infoOpen}
        onToggleInfo={() => setInfoOpen((v) => !v)}
      />
      {infoOpen && (
        <InfoPanel text={editor?.getText() ?? ''} createdAt={createdAt} updatedAt={updatedAt} />
      )}
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col overflow-auto" />
      <BottomToolbar editor={editor} />
    </div>
  );
}
