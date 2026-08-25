import { isMacOS } from '@tiptap/core';
import { EditorContent, type Editor, useEditor, useEditorState } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';

import { ExportMenu, type ExportFormat } from '@/features/export';
import { useT } from '@/i18n';

import { BottomToolbar } from './BottomToolbar';
import { EMPTY_FLAGS, editorFlagsSelector } from './editorState';
import { buildEditorExtensions } from './extensions';
import { HeadingMenu } from './HeadingMenu';
import { HighlightMenu } from './HighlightMenu';
import type { HighlightColor } from './Highlight';
import { pinAllSelectionStep } from './toolbarSelection';
import type { HeadingMenuRequest } from './HeadingFold';
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
  /**
   * Called with the live `editor` every time IT changes identity — in
   * particular the transition from `null` to a ready instance. The mount
   * effect's cleanup only clears `handleRef.current`, never calls this again
   * with `null` — so on unmount the caller's last-known `editor` value goes
   * stale rather than being told. `handleRef` is a plain ref: reading it once
   * from a caller's own effect races Tiptap's own construction, which is
   * exactly why `NoteEditor`'s fold persistence needs a reactive signal
   * instead of a ref read at a single moment.
   */
  onEditorReady?: (editor: Editor | null) => void;
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
  onEditorReady,
}: RichEditorProps): ReactElement {
  const t = useT();
  const [infoOpen, setInfoOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [menu, setMenu] = useState<HeadingMenuRequest | null>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  /**
   * The colour the toolbar's Highlight button applies. Sticky across clicks so
   * highlighting in one colour stays a single click; it is a session
   * preference, not note data, so it is deliberately NOT persisted — a colour
   * chosen once and silently reapplied on a later visit would be a surprise,
   * and the menu is one click away.
   */
  const [highlightColor, setHighlightColor] = useState<HighlightColor | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // The plugin reads its callback once, at construction, and `useEditor` reads
  // its options once, at mount. A ref keeps the identity stable while the
  // behaviour stays current — otherwise this component would freeze whatever
  // callback the very first render supplied.
  const activateRef = useRef(onActivateTag);
  activateRef.current = onActivateTag;

  // Same discipline as `activateRef` above, for `HeadingFold`'s `onOpenMenu`:
  // the extension array is built once in the `useState` initializer below, so
  // the plugin must capture a function whose IDENTITY never changes rather
  // than the `setMenu` state setter's value at that one moment. `setMenu`
  // itself is stable across renders, but routing it through a ref keeps this
  // callback's shape consistent with every other extension option this
  // component threads in, rather than being the one exception.
  const openMenuRef = useRef((request: HeadingMenuRequest) => setMenu(request));
  openMenuRef.current = (request: HeadingMenuRequest) => setMenu(request);

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
      // Unlike `onActivate`, this is unconditionally wired: the level menu is
      // a built-in editor affordance, not an opt-in prop the app may omit, so
      // there is no "nobody is listening" state to represent with `null` here.
      onOpenMenu: (request) => openMenuRef.current(request),
      foldHint: t('editor.fold.toggle'),
      // Read once at mount, like every option above it — the editor is keyed
      // by note id and rebuilt on a language change, so there is no live
      // language switch for these to miss.
      labels: {
        toolbar: t('editor.table.controls'),
        addRow: t('editor.table.addRow'),
        deleteRow: t('editor.table.deleteRow'),
        addColumn: t('editor.table.addColumn'),
        deleteColumn: t('editor.table.deleteColumn'),
        deleteTable: t('editor.table.deleteTable'),
      },
      // Read once at mount like every option above it — the editor is keyed
      // by note id and rebuilt on a language change, so there is no live
      // locale switch for these to miss.
      codeLabels: {
        trigger: t('editor.code.language'),
        none: t('editor.code.none'),
        filter: t('editor.code.filter'),
        empty: t('editor.code.empty'),
      },
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

  /**
   * The single source of formatting state for every surface below.
   *
   * `useEditorState` subscribes to transactions but re-renders only when the
   * SELECTED SLICE changes by `fast-deep-equal`. The alternative —
   * `shouldRerenderOnTransaction: true` on the `useEditor` call above — is one
   * line and is rejected: it re-renders this whole subtree on every keystroke
   * the user types, and this is a notes app.
   *
   * `?? EMPTY_FLAGS` rather than a nullable: the overload that accepts a
   * possibly-null editor returns `TSelectorResult | null`, and letting that
   * null reach the toolbars would put a `?.` on every flag read — which is the
   * kind of optionality that quietly turns back into "assume false".
   */
  const flags = useEditorState({ editor, selector: editorFlagsSelector }) ?? EMPTY_FLAGS;

  // `onEditorReady` is read through a ref, the same discipline as
  // `activateRef` above: the callback's IDENTITY must not be a dependency
  // here, or a caller that doesn't memoize it would tear this effect down
  // and rebuild `handleRef.current` on every one of its own re-renders.
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  useEffect(() => {
    handleRef.current = {
      getMarkdown: () => (editor === null ? initialMarkdown : serializeMarkdown(editor.getJSON())),
      editor,
    };
    onEditorReadyRef.current?.(editor);

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
            flags={flags}
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
        {/*
         * The colour menu is a SIBLING of the toolbar, not a child of it. The
         * pill is `overflow-x-auto`, which clips in both axes, so a popover
         * placed inside it would be cut off at its top edge with nothing to
         * show for it. Same reason `ExportMenu` sits beside `TopControls`
         * rather than within it.
         */}
        <div className="pointer-events-auto flex max-w-full flex-col items-center gap-2">
          {colorMenuOpen && (
            <HighlightMenu
              // What the cursor is actually sitting in wins over the sticky
              // button colour: with the caret inside a green highlight, the
              // menu that opens must say green.
              current={
                editor?.isActive('highlight') === true
                  ? ((editor.getAttributes('highlight').color as HighlightColor | null) ?? null)
                  : highlightColor
              }
              onChoose={(color) => {
                // The document mutation runs FIRST, before any React state
                // change. Closing the menu unmounts `HighlightMenu`, which
                // moves focus off the item it focused on open; doing that
                // before the command left the edit dependent on render timing
                // and the mark intermittently never landed.
                //
                // SETS rather than toggles when the mark is already there.
                // `toggleMark(type, attrs)` decides by `isActive(type, attrs)`,
                // so picking a DIFFERENT colour would already replace — but
                // picking the colour that is already checked would REMOVE the
                // highlight, contradicting the `menuitemradio` the user just
                // clicked. Same reasoning as the heading level menu, which
                // sets while its shortcut toggles.
                if (editor !== null) {
                  const chain = editor.chain().command(pinAllSelectionStep).focus();
                  if (editor.isActive('highlight')) {
                    chain.setHighlightColor(color).run();
                  } else {
                    chain.toggleHighlight(color).run();
                  }
                }

                setHighlightColor(color);
                setColorMenuOpen(false);
              }}
              onDismiss={() => setColorMenuOpen(false)}
            />
          )}
          <BottomToolbar
            editor={editor}
            flags={flags}
            highlightColor={highlightColor}
            colorMenuOpen={colorMenuOpen}
            onToggleColorMenu={() => setColorMenuOpen((open) => !open)}
          />
        </div>
      </div>

      {/*
       * `HeadingMenu` is `fixed`-positioned off the badge's own
       * `getBoundingClientRect()`, so it needs no placement of its own here —
       * unlike the toolbars above, it is not anchored to this pane at all.
       * Rendered by the app, never by the plugin: the editor learns nothing
       * about app concerns, the same boundary `onActivateTag` keeps.
       */}
      {menu !== null && (
        <HeadingMenu
          request={menu}
          // `.setTextSelection(menu.pos + 1)` before `setNode`, not left to
          // whatever the caret already sat at: the badge's own `mousedown`
          // calls `preventDefault()` and never moves ProseMirror's selection
          // to the clicked heading, so `setNode` without this targeted the
          // WRONG node — whatever the caret was already in, heading or not.
          // `menu.pos + 1` matches the widget's own offset (`section.pos +
          // 1`, the start of the heading's own content), so this always
          // lands inside the heading the user actually clicked.
          onSetLevel={(level) =>
            editor
              ?.chain()
              .focus()
              .setTextSelection(menu.pos + 1)
              .setNode('heading', { level })
              .run()
          }
          onToggleFold={() => editor?.commands.toggleHeadingFold(menu.pos)}
          onFoldAll={() => editor?.commands.foldAllHeadings()}
          onUnfoldAll={() => editor?.commands.unfoldAllHeadings()}
          onClose={() => {
            setMenu(null);
            // The only sensible destination: Task 4 measured that Chromium
            // refuses `.focus()` to any descendant of a heading containing a
            // widget, so returning focus to the badge/toggle that opened this
            // menu is not an option. Without this, Escape and every action
            // except `onSetLevel` (which already focuses as part of its own
            // chain) leave focus on the menu button React is about to unmount,
            // and it falls to `<body>` — the user's next keystroke goes nowhere.
            editor?.commands.focus();
          }}
        />
      )}
    </div>
  );
}
