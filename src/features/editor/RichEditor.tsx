import { isMacOS } from '@tiptap/core';
import { EditorContent, type Editor, useEditor } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';

import { BottomToolbar } from './BottomToolbar';
import { buildEditorExtensions } from './extensions';
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
  /**
   * Called with a tag name when the user Mod-clicks its pill. Returns whether
   * the app acted on it; `false` makes the gesture behave exactly like a plain
   * click, caret placement and all.
   */
  onActivateTag?: (tag: string) => boolean;
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
  onActivateTag,
}: RichEditorProps): ReactElement {
  const t = useT();
  const [infoOpen, setInfoOpen] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // The plugin reads its callback once, at construction, and `useEditor` reads
  // its options once, at mount. A ref keeps the identity stable while the
  // behaviour stays current — otherwise this component would freeze whatever
  // callback the very first render supplied.
  const activateRef = useRef(onActivateTag);
  activateRef.current = onActivateTag;

  const [extensions] = useState(() =>
    buildEditorExtensions({
      // `null`, not a wrapper that happens to call nothing, when no handler
      // was supplied at mount: `TagPillOptions.onActivate === null` is the
      // plugin's own "nobody is listening" signal, and it decides more than
      // whether the callback fires — it gates `preventDefault()` on the
      // mousedown handler too. Passing a non-null wrapper unconditionally
      // meant a `RichEditor` rendered with no `onActivateTag` still swallowed
      // a Mod-click and suppressed the caret placement a plain click would
      // have given, while its tooltip kept promising a filter that never
      // happened. Checked once, at the same mount boundary the plugin itself
      // reads once — a later prop change cannot flip whether listening is
      // "on" here, matching the plugin's own capture-once contract.
      // The wrapper must PROPAGATE the app's answer, not merely forward the
      // call: the plugin gates `preventDefault()` on this return value, so a
      // wrapper returning `undefined` would collapse every case — including
      // every successful filter — to "declined".
      onActivate: onActivateTag === undefined ? null : (tag) => activateRef.current?.(tag) === true,
      activateHint: t(isMacOS() ? 'editor.tagPill.hint.mac' : 'editor.tagPill.hint.other'),
    }),
  );

  const editor = useEditor({
    extensions,
    content: parseMarkdown(initialMarkdown),
    onUpdate: onChange,
    onBlur,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        // focus-visible:outline-none is intentional: the text caret is the focus indicator
        // for a contenteditable surface, and no editor rings its whole writing
        // area. Scoped to the pseudo-class (rather than a bare `outline-none`)
        // so its compiled specificity matches `Resizer`'s suppression — a bare
        // `.outline-none` ties in specificity with the global `:focus-visible`
        // ring and loses to it on source order alone.
        class: 'min-h-0 flex-1 bg-bg px-6 py-4 text-text focus-visible:outline-none',
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

  // The modifier-held affordance is a DOM attribute, not React state: setting
  // state on every `keydown` would re-render the editor's whole subtree on
  // every keystroke the user types while composing a note.
  useEffect(() => {
    // Derived from each event's own modifier flags rather than from tracking
    // which key went down: a keyup can be missed entirely (hold Cmd, press Tab
    // to leave the window), and then the pills would go on claiming to be
    // clickable while a plain click edits. `blur` is the backstop for the case
    // where no key event arrives at all.
    const sync = (held: boolean): void => {
      surfaceRef.current?.setAttribute('data-mod-held', String(held));
    };
    const fromEvent = (event: KeyboardEvent): void => {
      sync(isMacOS() ? event.metaKey : event.ctrlKey);
    };
    const clear = (): void => sync(false);

    window.addEventListener('keydown', fromEvent);
    window.addEventListener('keyup', fromEvent);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', fromEvent);
      window.removeEventListener('keyup', fromEvent);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return (
    <div ref={surfaceRef} data-mod-held="false" className="flex min-h-0 flex-1 flex-col">
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
