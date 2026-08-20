import { isMacOS } from '@tiptap/core';
import { EditorContent, type Editor, useEditor } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';

import { ExportMenu, type ExportFormat } from '@/features/export';
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
  /**
   * Called with the chosen destination when the user picks one from the export
   * menu. Omit it and no export control is rendered at all.
   */
  onExport?: (format: ExportFormat) => void;
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
  onExport,
}: RichEditorProps): ReactElement {
  const t = useT();
  const [infoOpen, setInfoOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
      //
      // The wrapper must PROPAGATE the app's answer, not merely forward the
      // call: the plugin gates `preventDefault()` on this return value, so a
      // wrapper returning `undefined` would collapse every case — including
      // every successful filter — to "declined". It also makes the `null`
      // above LOOK redundant, because `undefined === true` is `false` and both
      // paths then decline. They are not the same: `null` declines before the
      // hit test, a `false` answer after it, and `RichEditor.test.tsx` pins the
      // difference through a `posAtCoords` spy rather than through an outcome
      // the two now share.
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
        //
        // The vertical padding reserves room for the two floating toolbars
        // rather than merely spacing the prose: they overlay this surface, so
        // `pt-12` starts the first line below the top pill and `pb-24` lets the
        // last line scroll clear of the bottom one. Without the bottom reserve
        // the final line of every note sits permanently behind the formatting
        // bar with no way to scroll it into view, and the note still
        // round-trips perfectly — so only a computed-style test can see it.
        // `e2e/appearance.spec.ts` asserts the reserve covers each pill's
        // actual reach into the pane, which is what keeps this correct if
        // either toolbar's height or inset changes.
        class: 'min-h-0 flex-1 bg-bg px-6 pt-12 pb-24 text-text focus-visible:outline-none',
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
    // `relative` is what makes the three floating surfaces below position
    // against the editor pane. Placement lives here rather than inside each
    // component so the pill offsets are stated once, together, and cannot
    // drift apart — and so `TopControls`, `InfoPanel` and `BottomToolbar` stay
    // testable as plain groups of controls with no layout of their own.
    <div ref={surfaceRef} data-mod-held="false" className="relative flex min-h-0 flex-1 flex-col">
      {/*
       * The writing surface comes FIRST in the DOM, so the natural tab order
       * reaches the prose before the chrome and a screen reader meets the note
       * before its formatting controls. The visual stacking is set by
       * `absolute` + `z-10` on the chrome, not by source order.
       */}
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col overflow-auto" />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-end">
        {/*
         * `pointer-events-none` on the positioning wrapper and `auto` on the
         * pill: the wrapper spans the pane's full width, so without this it
         * would swallow every click on the first line of prose beneath it.
         */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <TopControls
            editor={editor}
            infoOpen={infoOpen}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            // Passed only when the app supplied a handler, so the control is
            // absent rather than inert when nobody is listening — the same rule
            // `onActivateTag` follows for the tag pill, and for the same reason:
            // an affordance that does nothing is worse than no affordance.
            exportOpen={onExport === undefined ? undefined : exportOpen}
            onToggleExport={
              onExport === undefined ? undefined : () => setExportOpen((open) => !open)
            }
          />
          {infoOpen && (
            <InfoPanel text={editor?.getText() ?? ''} createdAt={createdAt} updatedAt={updatedAt} />
          )}
          {exportOpen && onExport !== undefined && (
            <ExportMenu
              onChoose={(format) => {
                // Closed before the handler runs: PDF opens a modal print
                // dialog, and a menu still on screen behind it is left there
                // for as long as the dialog is up.
                setExportOpen(false);
                onExport(format);
              }}
              onDismiss={() => setExportOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex max-w-full">
          <BottomToolbar editor={editor} />
        </div>
      </div>
    </div>
  );
}
