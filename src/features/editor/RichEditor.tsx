import { isMacOS, posToDOMRect } from '@tiptap/core';
import { EditorContent, type Editor, useEditor, useEditorState } from '@tiptap/react';
import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';

import { ExportMenu, type ExportFormat } from '@/features/export';
import { useT } from '@/i18n';

import { BottomToolbar } from './BottomToolbar';
import type { ContextMenuRequest } from './ContextMenu';
import { EMPTY_FLAGS, editorFlagsSelector } from './editorState';
import { EditorContextMenu, type ContextMenuAction } from './EditorContextMenu';
import { buildEditorExtensions } from './extensions';
import { HeadingMenu } from './HeadingMenu';
import { HighlightMenu } from './HighlightMenu';
import { HighlightPalette, type HighlightChoiceResult } from './HighlightPalette';
import type { HighlightColor } from './Highlight';
import { COMMANDS, TABLE_ACTIONS, type TableAction } from './tableCommands';
import { pinAllSelectionStep } from './toolbarSelection';
import type { HeadingMenuRequest } from './HeadingFold';
import { InfoPanel } from './InfoPanel';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { TopControls } from './TopControls';

/**
 * Type guard over `ContextMenuAction`, not a bare `.includes` call: the
 * seven table actions are a `TableAction`, a strict subset of the sixteen
 * `ContextMenuAction`s, and this is what lets `handleContextMenuAction`
 * index `COMMANDS` (keyed only by `TableAction`) without a cast.
 */
function isTableAction(action: ContextMenuAction): action is TableAction {
  return (TABLE_ACTIONS as readonly string[]).includes(action);
}

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
 * Fallback size for the palette's very first measurement, before it has
 * ever mounted and `getBoundingClientRect()` has nothing real to read —
 * matches `HighlightPalette`'s row of six `size-5` (20px) swatches plus its
 * `p-1` padding and 1px border. See the placement effect below for why this
 * is only ever wrong for one frame.
 */
const PALETTE_ESTIMATED_HEIGHT = 36;
const PALETTE_ESTIMATED_WIDTH = 192;

/** Gap between the palette and the highlight it's anchored to, either side. */
const PALETTE_GAP = 8;

/**
 * The three-outcome switch `HighlightPalette` (and, later, the context menu)
 * hands back: a colour SETS it, `null` sets the default tint, and `'remove'`
 * unsets the mark entirely.
 *
 * `extendMarkRange('highlight')` before `unsetMark` is load-bearing: with a
 * collapsed caret, `unsetMark` alone affects the stored marks and not the
 * existing range, so the visible highlight would survive the click.
 *
 * The document mutation runs against the caret's own mark; no
 * `setTextSelection` is needed and none should be added — the selection never
 * left the highlight, because clicking chrome outside the editor does not
 * move it.
 */
function applyHighlightChoice(editor: Editor, result: HighlightChoiceResult): void {
  const chain = editor.chain().command(pinAllSelectionStep).focus();
  if (result === 'remove') {
    chain.extendMarkRange('highlight').unsetMark('highlight').run();
  } else {
    chain.setHighlightColor(result).run();
  }
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
  const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);
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

  // Same discipline again, for `ContextMenu.onOpen`: the plugin is built once
  // in the `useState` initializer below and captures whatever identity this
  // ref holds at that moment, so the ref (stable) rather than `setContextMenu`
  // itself (also stable, but kept consistent with every other extension
  // option here) is what gets threaded through. The REAL behaviour — moving
  // the selection, per CONTROLLER RULING R12 — is assigned below, after
  // `editor` exists; this initial value is only ever seen for the render
  // before `editor` mounts, when no `contextmenu` event can fire yet.
  const contextMenuRef = useRef((request: ContextMenuRequest) => setContextMenu(request));

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
      // Unconditionally wired, same as `onOpenMenu` above and for the same
      // reason: the context menu is a built-in editor affordance, not an
      // opt-in prop the app may omit.
      onOpen: (request) => contextMenuRef.current(request),
      // Read once at mount, like every option above it — the editor is keyed
      // by note id and rebuilt on a language change, so there is no live
      // language switch for these to miss.
      labels: {
        addRow: t('editor.table.addRowHandle'),
        addColumn: t('editor.table.addColumnHandle'),
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

  // CONTROLLER RULING R12: move the selection when the menu OPENS, not
  // before each command. Reassigned every render (like every other ref-held
  // callback in this file) so it always closes over the CURRENT `editor` —
  // it cannot be assigned any earlier in this function, because `editor`
  // does not exist yet at the point `contextMenuRef` itself is declared.
  //
  // The one conditional: if `request.pos` falls INSIDE the current
  // non-empty selection, the selection is left alone. Right-clicking inside
  // a selection to format it is standard behaviour in every editor, and an
  // unconditional `setTextSelection` here would collapse that selection to
  // a caret before the user's chosen command ever ran — Finding 3 from the
  // fix-round review, reproduced directly: select a run, right-click inside
  // it, choose Bold, and nothing got bolded because the selection was
  // already gone by the time the command ran.
  //
  // Doing this at OPEN time rather than per-command (the previous shape)
  // also fixes Finding 2 for free: `flags` is computed from
  // `editor.state.selection` by `useEditorState`, so moving the selection
  // here makes the menu's own displayed sections and checkmarks describe
  // the RIGHT-CLICKED position instead of wherever the caret happened to
  // already be — a right-click on a plain paragraph while the caret sat in
  // a table no longer shows the Table section.
  contextMenuRef.current = (request) => {
    if (editor !== null) {
      // `request.selection` (DOM-derived — see its own docblock on
      // `ContextMenuRequest`), not `editor.state.selection`: reading the
      // latter here reproduced Finding 3 intermittently, because it can
      // still report a stale, already-collapsed position for a brief
      // window after a pure keyboard (arrow-key) selection, and this
      // handler running inside that window would conclude "not inside a
      // selection" and collapse a selection that, on screen, the user still
      // had.
      const target = request.selection;
      const posInsideSelection =
        target !== null && request.pos >= target.from && request.pos <= target.to;
      if (posInsideSelection) {
        // Actively RESYNC to the real selection rather than merely
        // skipping — `editor.state.selection` may still be the stale one
        // described above, and leaving it untouched would leave that
        // staleness in place for the command that runs next.
        const current = editor.state.selection;
        if (current.from !== target.from || current.to !== target.to) {
          editor.commands.setTextSelection(target);
        }
      } else {
        editor.commands.setTextSelection(request.pos);
      }
    }
    setContextMenu(request);
  };

  /**
   * Viewport position of the palette, measured off the highlight itself.
   *
   * `fixed` chrome anchored to a document range has one hazard `HeadingMenu`
   * does not: that menu closes on the next click, so it cannot outlive its
   * anchor's position. This one stays up for as long as the caret is inside
   * the mark, so it MUST re-measure on scroll and on resize or it drifts away
   * from its own text. That is the accepted cost of not being a widget — an
   * inline widget would be laid out in the text flow and shove the sentence
   * sideways.
   *
   * `top`/`left` here are the box's own literal edges (not an anchor point
   * plus a CSS transform): flipping needs the palette's real rendered size,
   * which only exists once it has mounted, so the arithmetic below reads it
   * back off `paletteRef` the same way `HeadingMenu` reads its own menu's
   * `getBoundingClientRect()`.
   */
  const [paletteAt, setPaletteAt] = useState<{ top: number; left: number } | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  // Holds the placement effect's own `measure` so the post-mount correction
  // effect below can call the exact same function rather than a second copy
  // of its arithmetic. See that effect for why the correction is needed.
  const measurePaletteRef = useRef<(() => void) | null>(null);

  /**
   * The context menu's `onAction` dispatch, kept as one function rather than
   * inlined in the switch below.
   *
   * No `setTextSelection` here any more (CONTROLLER RULING R12) — the
   * selection is already correct by the time any of this runs, moved once
   * when the menu OPENED (`contextMenuRef.current`, above `flags`). Doing it
   * per-command here as well was Finding 3: it unconditionally collapsed
   * whatever selection the open-time logic had deliberately preserved,
   * because `setTextSelection(pos)` with `pos` inside a real selection still
   * collapses it to a caret at `pos` — so selecting a run, right-clicking
   * inside it, and choosing Bold formatted nothing.
   */
  function handleContextMenuAction(action: ContextMenuAction): void {
    if (editor === null || contextMenu === null) return;

    if (isTableAction(action)) {
      COMMANDS[action](editor.state, editor.view.dispatch);
      return;
    }

    const chain = editor.chain().command(pinAllSelectionStep).focus();
    switch (action) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'link': {
        // Same prompt-driven flow as the bottom toolbar's own link button —
        // see `BottomToolbar.tsx`'s `ACTIONS` entry for `link`. Not extracted
        // into a shared helper: this is the only other call site, and the
        // two already agree because both defer to `window.prompt` and the
        // same `unsetLink`/`setLink` pair.
        const href = window.prompt(t('editor.link.prompt'));
        if (href === null || href === '') {
          chain.unsetLink().run();
        } else {
          chain.extendMarkRange('link').setLink({ href }).run();
        }
        break;
      }
      case 'bulletList':
        chain.toggleBulletList().run();
        break;
      case 'orderedList':
        chain.toggleOrderedList().run();
        break;
      case 'taskList':
        chain.toggleTaskList().run();
        break;
      case 'codeBlock':
        chain.toggleCodeBlock().run();
        break;
      case 'blockquote':
        chain.toggleBlockquote().run();
        break;
    }
  }

  /**
   * No `setTextSelection` here either, for the same R12 reason as
   * `handleContextMenuAction` above: the selection was already moved (or
   * deliberately preserved) when the menu opened.
   */
  function handleSetContextHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void {
    if (editor === null || contextMenu === null) return;
    const chain = editor.chain().focus();
    if (level === 0) {
      chain.setNode('paragraph').run();
    } else {
      chain.setNode('heading', { level }).run();
    }
  }

  const highlightRange = flags.highlightRange;

  useEffect(() => {
    if (editor === null || highlightRange === null) {
      setPaletteAt(null);
      return;
    }

    const measure = (): void => {
      const rect = posToDOMRect(editor.view, highlightRange.from, highlightRange.to);

      // Real size once mounted; a reasonable guess for the very first paint,
      // when `paletteRef.current` doesn't exist yet — matches
      // `HighlightPalette`'s row of six `size-5` (20px) swatches plus its
      // `p-1` padding and border. Wrong by a few pixels for exactly one
      // frame is the same "good enough until measured" contract `HeadingMenu`
      // accepts for its own initial position.
      const size = paletteRef.current?.getBoundingClientRect();
      const height = size?.height ?? PALETTE_ESTIMATED_HEIGHT;
      const width = size?.width ?? PALETTE_ESTIMATED_WIDTH;

      // Flips BELOW the highlight when there is no room above it — the same
      // reasoning `HeadingMenu` documents for its own badge, verbatim:
      // `fixed` positioning means scrolling can never bring an off-screen
      // menu back, so a highlight in the TOP band of a long note (this
      // palette anchors above by default, unlike `HeadingMenu`'s below-first
      // default) is exactly where that matters, and ending up unreachable
      // there is the common case, not an edge case.
      //
      // Unlike `HeadingMenu`, which measures once per menu open (keyed on
      // `request`), this must be re-evaluated on every `measure()` call —
      // the mark can scroll between the top and bottom band repeatedly while
      // the palette stays open, and each scroll event calls this again.
      const fitsAbove = rect.top - PALETTE_GAP - height >= 0;
      const top = fitsAbove ? rect.top - PALETTE_GAP - height : rect.bottom + PALETTE_GAP;

      // Clamped horizontally into the viewport, the same way `HeadingMenu`
      // clamps its own `left` — a highlight near the pane's right edge would
      // otherwise push the centred palette off-screen sideways.
      const left = Math.min(
        Math.max(4, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 4,
      );

      setPaletteAt({ top, left });
    };

    measurePaletteRef.current = measure;
    measure();

    // `capture: true` on scroll: the editor's own scroller is a descendant,
    // and scroll does not bubble. Without capture the palette tracks window
    // scroll only, which in a three-pane app is the case that never happens.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      measurePaletteRef.current = null;
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // `highlightRange.from`/`.to` rather than `highlightRange`: the selector
    // rebuilds the object each call, so depending on its identity would
    // re-run this effect on every transaction.
  }, [editor, highlightRange?.from, highlightRange?.to]);

  /**
   * R9's correction pass. The effect above's very first `measure()` call
   * runs before `<HighlightPalette>` has ever mounted — `paletteAt` starts
   * `null`, so `paletteRef.current` is `null` too — and falls back to
   * `PALETTE_ESTIMATED_HEIGHT`/`WIDTH`. Those constants are accurate today,
   * but nothing re-measures against the REAL element until the next scroll
   * or resize, exactly the gap `HeadingMenu` closes for its own badge with a
   * measure-after-mount effect. Keyed on whether the palette is showing at
   * all (not on `paletteAt`'s own top/left, which this call itself changes,
   * or this would loop) — it runs once per open, right after the div this
   * effect's own state update causes to mount.
   */
  useEffect(() => {
    if (paletteAt === null) return;
    measurePaletteRef.current?.();
    // Depends on the open/closed TRANSITION, not on `paletteAt`'s own
    // top/left — this call's own `setPaletteAt` changes those, which would
    // otherwise loop.
  }, [paletteAt !== null]);

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
              // menu that opens must say green. Read through `flags`, the
              // editor-state subscription, rather than `editor.isActive` in
              // this render body — `useEditor` does not re-render on
              // transactions in Tiptap v3, so an `isActive` call made during
              // render is stale from the moment the caret moves.
              current={flags.highlight ? flags.highlightColor : highlightColor}
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
       * Gated on `contextMenu === null` too (fix round 2, Finding 5): R12
       * moves the selection when the context menu opens, so a right-click
       * inside a highlight now puts the caret inside the mark — which is
       * exactly what `paletteAt`'s own effect (below) watches for. Before
       * R12 a right-click never moved the selection, so this collision
       * could not happen; now, without this gate, right-clicking highlighted
       * text pops BOTH the palette (anchored above the mark) and the context
       * menu (anchored at the pointer, with its own redundant swatch row) at
       * once. The context menu's swatch row covers the same need while it is
       * open, so the palette simply steps aside rather than needing a
       * z-index fight.
       *
       * Also gated on `!colorMenuOpen`, for the identical reason: the
       * toolbar's own `HighlightMenu` and this palette are two independent
       * surfaces that both carry the accessible name "Highlight colour", and
       * with the caret already inside a highlight, opening the chevron's
       * menu renders both at once with nothing else to distinguish them.
       */}
      {paletteAt !== null && editor !== null && contextMenu === null && !colorMenuOpen && (
        // `top`/`left` are the box's own literal edges now (set by the
        // flip/clamp arithmetic above), not an anchor point plus a CSS
        // transform — so no `-translate-x-1/2 -translate-y-full` here,
        // unlike an always-above popover would need.
        <div
          ref={paletteRef}
          className="fixed z-20"
          style={{ top: paletteAt.top, left: paletteAt.left }}
        >
          <HighlightPalette
            current={flags.highlightColor}
            onChoose={(result) => applyHighlightChoice(editor, result)}
            onDismiss={() => editor.commands.focus()}
          />
        </div>
      )}

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

      {/*
       * Rendered by the app, never by the plugin — same boundary as
       * `HeadingMenu` above: `ContextMenu.ts` owns the DOM event and hands a
       * request up through `onOpen`, and this is the only place that turns a
       * menu choice into an editor command.
       */}
      {contextMenu !== null && editor !== null && (
        <EditorContextMenu
          request={contextMenu}
          flags={flags}
          onAction={handleContextMenuAction}
          onSetHeading={handleSetContextHeading}
          onSetHighlight={(result) => applyHighlightChoice(editor, result)}
          onClose={() => {
            setContextMenu(null);
            editor.commands.focus();
          }}
        />
      )}
    </div>
  );
}
