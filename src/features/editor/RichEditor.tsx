import { EditorContent, useEditor } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect } from 'react';

import { editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';

export interface RichEditorHandle {
  getMarkdown: () => string;
}

export interface RichEditorProps {
  /** Read once, at mount. This component is expected to be keyed by note id. */
  initialMarkdown: string;
  onChange: () => void;
  onBlur: () => void;
  ariaLabel: string;
  handleRef: RefObject<RichEditorHandle | null>;
  /** Displayed by the info panel, which Task 11 adds. Unused until then. */
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
}: RichEditorProps): ReactElement {
  const editor = useEditor({
    extensions: editorExtensions,
    content: parseMarkdown(initialMarkdown),
    onUpdate: onChange,
    onBlur,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class: 'min-h-0 flex-1 bg-bg px-6 py-4 text-sm text-text outline-none',
      },
    },
  });

  useEffect(() => {
    handleRef.current = {
      getMarkdown: () => (editor === null ? initialMarkdown : serializeMarkdown(editor.getJSON())),
    };

    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef, initialMarkdown]);

  return <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />;
}
