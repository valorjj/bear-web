import type { Editor } from '@tiptap/react';
import { Fragment, type ReactElement, useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { useLayoutMode } from '@/lib/useLayoutMode';
import { useVisibleViewport } from '@/lib/visibleViewport';
import type { TranslationKey } from '@/i18n';
import {
  Bold,
  ChevronDown,
  Code,
  Superscript,
  Ellipsis,
  Heading,
  Highlighter,
  Icon,
  ImageGlyph,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  MessageSquareQuote,
  Strikethrough,
  TableGlyph,
} from '@/ui/Icon';
import type { LucideIcon } from '@/ui/Icon';

import type { EditorFlags } from './editorState';
import type { HighlightColor } from './Highlight';
import { pinAllSelectionStep } from './toolbarSelection';
import { ToolbarOverflowSheet } from './ToolbarOverflowSheet';

export interface BottomToolbarProps {
  editor: Editor | null;
  /**
   * The colour the Highlight BUTTON applies. Owned by the parent alongside the
   * menu's open state, so the button and the menu cannot disagree about which
   * colour is current.
   */
  highlightColor: HighlightColor | null;
  /** Whether the callout menu is open — drives `aria-expanded` on its button. */
  calloutMenuOpen: boolean;
  /**
   * Toggles the callout menu, handing over the button's own element so the
   * menu can anchor to it. The menu is `position: fixed` and placed by
   * `useAnchoredMenu`; a rect measured anywhere but at the click would be a
   * second source of truth for where this button is.
   */
  onToggleCalloutMenu: (opener: HTMLElement) => void;
  /** Whether the colour menu is open — drives `aria-expanded` on the chevron. */
  colorMenuOpen: boolean;
  onToggleColorMenu: () => void;
  /** Whether the link address popover is open — drives `aria-expanded` on the Link button. */
  linkMenuOpen: boolean;
  /**
   * Toggles the link popover, handing over the button's own element.
   *
   * The popover anchors to the SELECTION, not to this button — but
   * `useAnchoredMenu` still needs the opener, so its outside-mousedown
   * listener does not treat this button as outside. Without it the button
   * cannot close its own popover: the listener closes on mousedown and the
   * click reopens, in that order.
   */
  onToggleLinkMenu: (opener: HTMLElement) => void;
  /**
   * Hands over the files chosen from the picker. Absent — not disabled — when
   * this editor cannot store an image, so the button is not rendered at all:
   * the same rule `ExportMenu`'s items follow, and the reason `ImagePaste`
   * registers no plugin when `onImage` is null. A control that silently does
   * nothing is worse than one that is not there.
   */
  onPickImages?: (files: File[]) => void;
  /** Live formatting state at the caret. See `editorState.ts`. */
  flags: EditorFlags;
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
    | 'callout'
    | 'footnote'
    | 'table';
  label: TranslationKey;
  glyph: LucideIcon;
  /**
   * Every action receives the current highlight colour, though only
   * `highlight` reads it. The alternative — branching on `action.key` inside
   * the render loop — would put one action's behaviour somewhere other than
   * its own row in this table, which is the property that makes the table
   * worth having.
   *
   * A translator used to be threaded in here too, for the one action that
   * needed a user-facing string: `link`, which called `window.prompt` with a
   * translated label. The popover owns that string now, so the parameter and
   * its local `Translate` alias are gone rather than left unused with their
   * justification still attached.
   */
  run: (editor: Editor, highlightColor: HighlightColor | null) => void;
  /**
   * The `EditorFlags` key this action's pressed state reads.
   *
   * A KEY, not a predicate. A predicate would take an `Editor` and be called
   * during render, which is exactly the shape that let this toolbar report
   * stale state from M4 to H: `useEditor` does not re-render on transactions
   * in Tiptap v3, so a render-time read is only as fresh as React's last
   * unrelated reason to run. Reading a key off a subscribed object makes that
   * mistake unavailable rather than merely discouraged.
   */
  /**
   * Omitted by an action that INSERTS rather than toggles — the footnote
   * button. Such a control has no state to reflect, and pointing it at an
   * unrelated flag so the field could stay required would make the button
   * report something that is not about it.
   */
  active?: keyof EditorFlags;
  /**
   * Moves this control out of the strip and into the overflow sheet on any
   * viewport narrower than `desktop`.
   *
   * MEASURED, not guessed: at 390x844 the strip's `scrollWidth` was 720
   * against a `clientWidth` of 350, so 8 of its 15 controls sat behind a
   * horizontal scroll — every insert control added since J3 among them.
   *
   * Which 8 is a choice about FREQUENCY, not an inheritance of whichever 7
   * happened to fit: the incidental split gave Numbered list and
   * Strikethrough prime position while Link, which people reach for
   * constantly, sat off-screen. Structure and emphasis stay in the strip;
   * insertion goes one tap behind. The cost, taken deliberately, is that
   * toggling an overflow control twice is now four taps rather than a scroll
   * and two — paid because the scroll is a gesture most people never make,
   * and a control nobody finds is worse than one that is two taps away.
   */
  overflow?: true;
}

/**
 * The shape every control in the strip shares.
 *
 * Hoisted when the image button joined, so the two cannot drift: the touch
 * sizing here (`coarse:size-11` — 44px of real INK, which J2's pseudo-element
 * approach cannot deliver inside an `overflow-x-auto` strip) is a measured
 * rule, and a second button pasted with a stale copy of it would be 28px on a
 * phone with nothing to catch it.
 */
const TOOLBAR_BUTTON =
  'h-7 shrink-0 rounded-sm text-ui text-muted coarse:size-11 coarse:rounded-md transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:bg-selected aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40';

const ACTIONS: readonly Action[] = [
  {
    key: 'heading',
    label: 'editor.toolbar.heading',
    glyph: Heading,
    run: (editor) =>
      editor.chain().command(pinAllSelectionStep).focus().toggleHeading({ level: 1 }).run(),
    active: 'heading1',
  },
  {
    key: 'checklist',
    label: 'editor.toolbar.checklist',
    glyph: ListTodo,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleTaskList().run(),
    active: 'taskList',
  },
  {
    key: 'bulletList',
    overflow: true,
    label: 'editor.toolbar.bulletList',
    glyph: List,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBulletList().run(),
    active: 'bulletList',
  },
  {
    key: 'orderedList',
    overflow: true,
    label: 'editor.toolbar.orderedList',
    glyph: ListOrdered,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleOrderedList().run(),
    active: 'orderedList',
  },
  {
    key: 'bold',
    label: 'editor.toolbar.bold',
    glyph: Bold,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBold().run(),
    active: 'bold',
  },
  {
    key: 'italic',
    label: 'editor.toolbar.italic',
    glyph: Italic,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleItalic().run(),
    active: 'italic',
  },
  {
    key: 'strike',
    overflow: true,
    label: 'editor.toolbar.strike',
    glyph: Strikethrough,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleStrike().run(),
    active: 'strike',
  },
  {
    key: 'highlight',
    overflow: true,
    label: 'editor.toolbar.highlight',
    glyph: Highlighter,
    // Toggles the LAST-CHOSEN colour, so highlighting stays one click. The
    // chevron beside it is the route to a different one.
    run: (editor, color) =>
      editor.chain().command(pinAllSelectionStep).focus().toggleHighlight(color).run(),
    active: 'highlight',
  },
  {
    key: 'link',
    label: 'editor.toolbar.link',
    glyph: Link,
    // Opens the address popover rather than running a command, so `run` is
    // never called for it — the same shape as `callout` above, and the click
    // handler below branches on the key for both.
    //
    // What this replaces was `window.prompt`, and it carried a defect worth
    // naming so it is not reintroduced: `prompt` returns `null` on Cancel,
    // this handler read that as "unset the link", and dismissing the dialog
    // therefore DESTROYED an existing link. `LinkMenu` cannot express that —
    // dismissing calls `onDismiss`, which touches nothing.
    run: () => {},
    active: 'link',
  },
  {
    key: 'footnote',
    overflow: true,
    label: 'editor.toolbar.footnote',
    glyph: Superscript,
    // One command on one transaction, so one undo restores the marker and its
    // footnote together. See `Footnote.ts`.
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().insertFootnote().run(),
    // No `active`: a footnote is inserted, never toggled.
  },
  {
    key: 'code',
    overflow: true,
    label: 'editor.toolbar.code',
    glyph: Code,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleCodeBlock().run(),
    active: 'codeBlock',
  },
  {
    key: 'table',
    overflow: true,
    label: 'editor.toolbar.table',
    glyph: TableGlyph,
    // Three columns and two rows with a header, which is the shape a user almost
    // always wants and the one Bear's own button inserts.
    run: (editor) =>
      editor
        .chain()
        .command(pinAllSelectionStep)
        .focus()
        .insertTable({ rows: 2, cols: 3, withHeaderRow: true })
        .run(),
    active: 'table',
  },
  {
    key: 'callout',
    overflow: true,
    label: 'editor.toolbar.callout',
    glyph: MessageSquareQuote,
    // Opens the type menu rather than running a command, so `run` is never
    // called for it — see the click handler below, which branches on the key.
    // The six choices INCLUDE a plain quote, which is why this button replaced
    // the Quote button rather than joining it: one control, one popup, and no
    // chevron that reads as a generic "more tools" affordance. The cost, taken
    // deliberately, is that a plain blockquote is now two clicks.
    run: () => {},
    active: 'blockquote',
  },
];

/**
 * Bear's floating bottom toolbar — floating for real since M8, having spent
 * M4 to M7.5 as a full-width bar welded to the bottom of the window.
 *
 * `w-fit` with a `max-w-full` cap is what keeps the narrow-viewport contract
 * intact: the pill shrinks to its content at a comfortable width (so
 * `overflow-x-auto` adds no scrollbar and `scrollWidth === clientWidth`), and
 * is capped rather than allowed to overflow the pane when eleven icon buttons
 * no longer fit — at which point its own `scrollLeft` is the scrolling
 * container, not the pane's. `e2e/appearance.spec.ts` pins both halves.
 *
 * Placement is the parent's job; see `TopControls`.
 */
export function BottomToolbar({
  editor,
  highlightColor,
  colorMenuOpen,
  onToggleColorMenu,
  linkMenuOpen,
  onToggleLinkMenu,
  onPickImages,
  calloutMenuOpen,
  onToggleCalloutMenu,
  flags,
}: BottomToolbarProps): ReactElement {
  const t = useT();
  const picker = useRef<HTMLInputElement | null>(null);
  const mode = useLayoutMode();
  const [overflowAnchor, setOverflowAnchor] = useState<{
    rect: DOMRect;
    opener: HTMLElement;
  } | null>(null);

  /*
   * The split is by LAYOUT WIDTH, not by pointer coarseness, because what
   * runs out is horizontal room rather than fingers: a tablet at 768px has a
   * fine pointer and still cannot seat 15 controls beside a note. `desktop`
   * is where `appearance.spec.ts` already pins `scrollWidth === clientWidth`
   * for the full strip, so that is the boundary.
   *
   * Residual case, named rather than papered over: at exactly 1024 the
   * editor pane is ~424px and the fine-pointer strip is ~540, so the widest
   * `desktop` layouts still scroll a little. That predates this and is a far
   * milder miss than 8 controls off a phone; if it is worth closing, the fix
   * is measuring the strip rather than adding a third breakpoint.
   */
  /*
   * The sheet closes when the keyboard opens or shuts.
   *
   * `useAnchoredMenu` measures ONCE against the anchor rect it is handed, and
   * the `⋯` button moves when `RichEditor` lifts the toolbar clear of the
   * keyboard — so a sheet opened in the same moment the keyboard arrives is
   * placed against where the button used to be, and never corrects. Found as
   * a test that passed alone and failed in its file: the click landed before
   * the lift had propagated, which is a real gesture (tapping `⋯` as the
   * keyboard animates in), not a test artifact.
   *
   * Closing rather than re-measuring, because re-measuring correctly would
   * mean re-reading the opener's rect on every viewport change — a change to
   * the hook that five other menus share, for a case where dismissing is
   * also the honest behaviour: the surface the user aimed at has moved.
   */
  const keyboardInset = useVisibleViewport();
  useEffect(() => {
    setOverflowAnchor(null);
  }, [keyboardInset]);

  const compact = mode !== 'desktop';
  const stripActions = compact ? ACTIONS.filter((action) => action.overflow !== true) : ACTIONS;
  const sheetActions = compact ? ACTIONS.filter((action) => action.overflow === true) : [];

  const imageButton =
    onPickImages === undefined ? null : (
      <button
        type="button"
        aria-label={t('editor.toolbar.image')}
        disabled={editor === null}
        onClick={() => picker.current?.click()}
        className={`${TOOLBAR_BUTTON} px-2`}
      >
        <Icon glyph={ImageGlyph} />
      </button>
    );

  function renderAction(action: Action): ReactElement {
    return (
      <Fragment key={action.key}>
        <button
          type="button"
          aria-label={t(action.label)}
          // `undefined`, not `false`, for an action with no toggle state:
          // `aria-pressed="false"` announces a button that is currently OFF,
          // which is a different claim from a button that does not toggle.
          aria-pressed={action.active === undefined ? undefined : flags[action.active] === true}
          // `dialog` for the link popover, not `menu`: it holds a text
          // field and two buttons, and a screen reader announcing "menu"
          // there promises arrow-key navigation between items that do not
          // exist.
          aria-haspopup={
            action.key === 'callout' ? 'menu' : action.key === 'link' ? 'dialog' : undefined
          }
          aria-expanded={
            action.key === 'callout'
              ? calloutMenuOpen
              : action.key === 'link'
                ? linkMenuOpen
                : undefined
          }
          disabled={editor === null}
          onClick={(event) => {
            // The sheet closes behind every choice, including the three that
            // open a popover of their own. One rule rather than "toggles keep
            // it open, inserts close it", which is a distinction the user
            // would have to hold in their head; and the popover anchors on
            // the button that was tapped, so it appears where the finger was
            // rather than back at the strip.
            setOverflowAnchor(null);
            if (action.key === 'callout') {
              onToggleCalloutMenu(event.currentTarget);
              return;
            }
            if (action.key === 'link') {
              onToggleLinkMenu(event.currentTarget);
              return;
            }
            if (editor !== null) action.run(editor, highlightColor);
          }}
          // `touch:size-11` is 44x44 of real ink on a coarse pointer (J3).
          //
          // J2 left this button at 28px deliberately and recorded why: it
          // expands hit areas with a pseudo-element, and `overflow-x-auto`
          // on the strip forces a non-visible `overflow-y` that clips one.
          // The utility was applied, measured, and removed. Growing the ink
          // is the only route and it reflows the strip, which J2 refused to
          // do and J3 owns.
          className={`${TOOLBAR_BUTTON} ${
            // The highlight pair reads as ONE control: the button loses its
            // trailing inset so the chevron sits against it rather than a
            // full gap away. Only `highlight` still has a chevron — the
            // callout menu hangs off a stand-alone button now.
            action.key === 'highlight' ? 'pr-0.5 pl-2' : 'px-2'
          }`}
        >
          <Icon glyph={action.glyph} />
        </button>
        {action.key === 'highlight' && (
          <button
            type="button"
            aria-label={t('editor.toolbar.highlightColor')}
            aria-haspopup="menu"
            aria-expanded={colorMenuOpen}
            disabled={editor === null}
            onClick={() => {
              setOverflowAnchor(null);
              onToggleColorMenu();
            }}
            // The narrowest control in the app at ~18px, and the only route
            // to the highlight colours. It keeps its narrow width so it
            // still reads as one control with the button it follows, and
            // takes the strip's full height instead.
            className="h-7 shrink-0 touch:h-11 rounded-sm pr-2 pl-0.5 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-expanded:bg-selected aria-expanded:text-text disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon glyph={ChevronDown} size="sm" />
          </button>
        )}
      </Fragment>
    );
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('editor.toolbar.bottom')}
        // `touch:h-14` grows the strip so its buttons can be 44px of real INK
        // (J3). J2 could not do this: it expands hit areas with a pseudo-element
        // and never reflows, and a pseudo-element cannot work here anyway —
        // `overflow-x-auto` forces a non-visible `overflow-y`, so a 44px overlay
        // on a 28px button is generated and then clipped to the strip. Growing
        // the ink is the only route, and growing is a reflow, which is J3's.
        //
        // `bear-scroll-fade` is the edge affordance: the strip has always
        // scrolled, and until now it was simply clipped at the right edge with
        // nothing to say more existed.
        className="bear-scroll-fade flex h-9 w-fit max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-surface px-2 shadow-popover coarse:h-14 coarse:gap-1 coarse:px-3"
      >
        {stripActions.map(renderAction)}

        {/*
         * The overflow control, rendered only where the strip cannot seat
         * everything. Last in the strip, after the controls it stands in for,
         * so the reading order matches the visual one.
         */}
        {compact && (
          <button
            type="button"
            aria-label={t('editor.toolbar.more')}
            aria-haspopup="menu"
            aria-expanded={overflowAnchor !== null}
            disabled={editor === null}
            onClick={(event) => {
              const opener = event.currentTarget;
              setOverflowAnchor((open: { rect: DOMRect; opener: HTMLElement } | null) =>
                open === null ? { rect: opener.getBoundingClientRect(), opener } : null,
              );
            }}
            className={`${TOOLBAR_BUTTON} px-2 aria-expanded:bg-selected aria-expanded:text-text`}
          >
            <Icon glyph={Ellipsis} />
          </button>
        )}

        {/*
         * The image picker's INPUT, rendered outside the `ACTIONS` table
         * because it is CONDITIONAL and the table is a static constant — the
         * same reason the highlight chevron sits outside it.
         *
         * Bear's own help describes this control as "the attach function
         * (which looks like a photo)" and puts it in the toolbar, which is
         * where this is and what it looks like. It accepts images only, so a
         * photo glyph is the honest label as well as the familiar one; a
         * paperclip would promise the PDFs and arbitrary files Bear takes and
         * this does not.
         *
         * The INPUT stays in the strip while its BUTTON may move to the
         * overflow sheet, and that separation is load-bearing rather than
         * tidiness: the sheet closes on the tap that opens the OS file dialog,
         * so an input rendered inside it would be unmounted by the time
         * `change` fires — the user picks a photo and the app silently drops
         * it. Keeping the input here means the ref survives the sheet.
         */}
        {onPickImages !== undefined && (
          <>
            {!compact && imageButton}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              data-image-picker
              // The BUTTON is the accessible control; this input is plumbing.
              // Labelling both put two "Insert image" entries in the
              // accessibility tree for one affordance, and a screen-reader user
              // would meet the second with no way to tell it apart. Hidden from
              // the tree and out of the tab order, it can still be `.click()`ed,
              // which is the only thing it is here to do.
              aria-hidden="true"
              tabIndex={-1}
              // `sr-only`, never `display: none`: a display-none input cannot
              // be opened programmatically in every browser.
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                // Cleared BEFORE handing the files on, so choosing the same
                // file twice in a row still fires `change`. The input keeps its
                // value otherwise, and the second pick is silently ignored —
                // which reads as "the app dropped my image".
                event.target.value = '';
                if (files.length > 0) onPickImages(files);
              }}
            />
          </>
        )}
      </div>

      {/*
       * Rendered outside the strip's own element rather than within it, for
       * the reason the colour menu is: the pill is `overflow-x-auto`, which
       * clips in both axes. The sheet PORTALS out of this subtree entirely
       * (see `ToolbarOverflowSheet`), so this placement is belt to that
       * braces rather than the thing that makes it work.
       */}
      {overflowAnchor !== null && (
        <ToolbarOverflowSheet anchor={overflowAnchor} onDismiss={() => setOverflowAnchor(null)}>
          {sheetActions.map(renderAction)}
          {imageButton}
        </ToolbarOverflowSheet>
      )}
    </>
  );
}
