import type { Editor } from '@tiptap/react';
import { Fragment, type ReactElement } from 'react';

import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import {
  Bold,
  ChevronDown,
  Code,
  Heading,
  Highlighter,
  Icon,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
  TableGlyph,
} from '@/ui/Icon';
import type { LucideIcon } from '@/ui/Icon';

import type { EditorFlags } from './editorState';
import type { HighlightColor } from './Highlight';
import { pinAllSelectionStep } from './toolbarSelection';

type Translate = (key: TranslationKey) => string;

export interface BottomToolbarProps {
  editor: Editor | null;
  /**
   * The colour the Highlight BUTTON applies. Owned by the parent alongside the
   * menu's open state, so the button and the menu cannot disagree about which
   * colour is current.
   */
  highlightColor: HighlightColor | null;
  /** Whether the callout menu is open — drives `aria-expanded` on its chevron. */
  calloutMenuOpen: boolean;
  onToggleCalloutMenu: () => void;
  /** Whether the colour menu is open — drives `aria-expanded` on the chevron. */
  colorMenuOpen: boolean;
  onToggleColorMenu: () => void;
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
    | 'quote'
    | 'table';
  label: TranslationKey;
  glyph: LucideIcon;
  /**
   * `t` is threaded in rather than read from a hook because ACTIONS is a
   * module-level constant. The link action needs a translated prompt, and no
   * user-facing string may be hardcoded in a component.
   */
  /**
   * Every action receives the current highlight colour, though only
   * `highlight` reads it. The alternative — branching on `action.key` inside
   * the render loop — would put one action's behaviour somewhere other than
   * its own row in this table, which is the property that makes the table
   * worth having.
   */
  run: (editor: Editor, t: Translate, highlightColor: HighlightColor | null) => void;
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
  active: keyof EditorFlags;
}

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
    label: 'editor.toolbar.bulletList',
    glyph: List,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBulletList().run(),
    active: 'bulletList',
  },
  {
    key: 'orderedList',
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
    label: 'editor.toolbar.strike',
    glyph: Strikethrough,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleStrike().run(),
    active: 'strike',
  },
  {
    key: 'highlight',
    label: 'editor.toolbar.highlight',
    glyph: Highlighter,
    // Toggles the LAST-CHOSEN colour, so highlighting stays one click. The
    // chevron beside it is the route to a different one.
    run: (editor, _t, color) =>
      editor.chain().command(pinAllSelectionStep).focus().toggleHighlight(color).run(),
    active: 'highlight',
  },
  {
    key: 'link',
    label: 'editor.toolbar.link',
    glyph: Link,
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
    active: 'link',
  },
  {
    key: 'code',
    label: 'editor.toolbar.code',
    glyph: Code,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleCodeBlock().run(),
    active: 'codeBlock',
  },
  {
    key: 'table',
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
    key: 'quote',
    label: 'editor.toolbar.quote',
    glyph: Quote,
    run: (editor) => editor.chain().command(pinAllSelectionStep).focus().toggleBlockquote().run(),
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
  calloutMenuOpen,
  onToggleCalloutMenu,
  flags,
}: BottomToolbarProps): ReactElement {
  const t = useT();

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar.bottom')}
      className="flex h-9 w-fit max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-surface px-2 shadow-popover"
    >
      {ACTIONS.map((action) => (
        <Fragment key={action.key}>
          <button
            type="button"
            aria-label={t(action.label)}
            aria-pressed={flags[action.active] === true}
            disabled={editor === null}
            onClick={() => editor !== null && action.run(editor, t, highlightColor)}
            // NO `touch-target-y` here, and the reason is a hard blocker
            // rather than an oversight (J2).
            //
            // This strip is `overflow-x-auto`, and CSS forces `overflow-y` to
            // a non-visible value whenever `overflow-x` is not visible — the
            // computed pair measures `auto`/`auto`. So a 44px `::after` on a
            // 28px button inside a 36px strip is generated at its full height
            // (verified: `height: 44px`) and then CLIPPED to the strip, which
            // means it receives no tap the ink would not have received anyway.
            // The utility would emit and do nothing, which is the exact shape
            // of the dead `hover:bg-hover` this project shipped for two
            // milestones.
            //
            // The only route to 44px here is a taller strip, and that is a
            // reflow of a floating toolbar whose reserved bottom padding in
            // `RichEditor` is asserted by `e2e/appearance.spec.ts` — J3's
            // work, not J2's. `TopControls` is the same shape WITHOUT the
            // overflow, so it does carry the utility and `e2e/touch.spec.ts`
            // proves it works there.
            //
            // (That padding is named in prose rather than written as its
            // utility: `scripts/sourceLint.test.ts`'s spacing scan reads
            // comments too, and a backticked utility in a comment reads to it
            // as an off-scale value in the markup.)
            className={`h-7 shrink-0 rounded-sm text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-pressed:bg-selected aria-pressed:text-text disabled:pointer-events-none disabled:opacity-40 ${
              // The highlight pair reads as ONE control: the button loses its
              // trailing inset so the chevron sits against it rather than a
              // full gap away.
              action.key === 'highlight' || action.key === 'quote' ? 'pr-0.5 pl-2' : 'px-2'
            }`}
          >
            <Icon glyph={action.glyph} />
          </button>
          {(action.key === 'highlight' || action.key === 'quote') && (
            <button
              type="button"
              aria-label={t(
                action.key === 'highlight'
                  ? 'editor.toolbar.highlightColor'
                  : 'editor.toolbar.calloutType',
              )}
              aria-haspopup="menu"
              aria-expanded={action.key === 'highlight' ? colorMenuOpen : calloutMenuOpen}
              disabled={editor === null}
              onClick={action.key === 'highlight' ? onToggleColorMenu : onToggleCalloutMenu}
              // Same clipping blocker as its sibling above, and the same
              // deferral to J3 — despite this being the narrowest control in
              // the app at ~18px and the only route to the highlight colours
              // and the callout types.
              className="h-7 shrink-0 rounded-sm pr-2 pl-0.5 text-ui text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover aria-expanded:bg-selected aria-expanded:text-text disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon glyph={ChevronDown} size="sm" />
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
