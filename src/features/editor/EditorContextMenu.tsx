import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';
import {
  Ban,
  Bold,
  Code,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Icon,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Rows3,
  Strikethrough,
  Trash2,
} from '@/ui/Icon';

import type { ContextMenuRequest } from './ContextMenu';
import type { EditorFlags } from './editorState';
import type { HighlightChoiceResult } from './HighlightPalette';
import { HIGHLIGHT_CHOICES } from './highlightChoices';

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const HEADING_GLYPHS = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6] as const;

/**
 * The sixteen actions this menu reports through `onAction` — the eleven
 * inline/block toggles, plus the seven table row names Task 8 supplies
 * commands for (heading levels and highlight colours go through their own
 * dedicated callbacks instead, since those are radio choices, not toggles).
 */
export type ContextMenuAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'codeBlock'
  | 'blockquote'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable';

export interface EditorContextMenuProps {
  request: ContextMenuRequest;
  flags: EditorFlags;
  onAction: (action: ContextMenuAction) => void;
  onSetHeading: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => void;
  onSetHighlight: (result: HighlightChoiceResult) => void;
  onClose: () => void;
}

const ITEM_CLASS =
  'text-ui-sm text-text hover:bg-hover flex w-full items-center gap-2 rounded px-2 py-1 text-left';
const DESTRUCTIVE_CLASS =
  'text-ui-sm text-danger hover:bg-hover flex w-full items-center gap-2 rounded px-2 py-1 text-left';

/**
 * The editor's right-click (and `Shift-F10`/`ContextMenu`-key) menu.
 *
 * Rendered by the app, never by the plugin: `ContextMenu.ts` owns the DOM
 * event and hands a request up; this component draws the menu and reports
 * every choice back through callbacks. It executes no editor command itself —
 * `RichEditor` (Task 10) is the only thing that calls into Tiptap.
 *
 * FLAT by design: no submenus, no `aria-haspopup`. Heading levels and
 * highlight colours are inline rows rather than nested flyouts — hover-intent
 * on a flyout (diagonal travel, open/close timers, a keyboard model for
 * entering and leaving) is a large class of bugs bought for one saved click.
 *
 * No clipboard rows either. A custom Paste row cannot read the clipboard
 * without `navigator.clipboard.readText()`, which is permission-gated and
 * prompts; a row that either fails or nags is worse than none, and Cut/Copy
 * without Paste would read as a bug. The native shortcuts keep working
 * regardless — this menu simply says nothing about them.
 */
export function EditorContextMenu({
  request,
  flags,
  onAction,
  onSetHeading,
  onSetHighlight,
  onClose,
}: EditorContextMenuProps): ReactElement {
  const t = useT();
  // Placement, initial focus, Escape/outside dismissal and the Tab trap all
  // come from `useAnchoredMenu`.
  //
  // `flags.table` is passed as a re-measure trigger (not the whole `flags`
  // object, which is a fresh object every transaction): the table section is
  // the one conditional block that changes this menu's natural height after
  // the initial mount, and nothing else would re-run the measurement when it
  // flips true a render after `request` first arrived — which left a stale,
  // pre-table-section position uncorrected.
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose, [
    flags.table,
  ]);

  function act(action: ContextMenuAction): void {
    onAction(action);
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('editor.context.menu')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        // Bounds the menu's own rendered height to whatever fits between the
        // two `MENU_GAP` margins, regardless of which edge it's measured
        // from — this menu can be taller than the viewport (five sections
        // plus a seven-row table section, ~530px, on a 720px-tall window),
        // and no flip/clamp choice between "above" and "below" can rescue
        // that; only a bounded height with its own scroll can. See Finding 1.
        // `dvh`, not `vh`. On mobile `100vh` is the LARGE viewport: it
        // ignores the browser's own collapsing chrome, so a tall menu clamped
        // against it can still run past the bottom of the screen. `dvh` is
        // the viewport as it actually is right now.
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      // `min-w-56`, wider than `HeadingMenu`'s `min-w-48`: five sections and a
      // table row list carry more content than a single level list, and
      // `min-w-48` visibly clipped the longer table row labels in a spike.
      // `overflow-y-auto` is what makes the `maxHeight` above a scrollable
      // clamp rather than a silent, unreachable crop — every row stays
      // reachable by scrolling the menu itself.
      className="bg-surface border-border shadow-popover fixed z-20 min-w-56 overflow-y-auto rounded-md border p-1"
    >
      {/* 1. Heading — an inline glyph row, then a labelled paragraph row. */}
      <div role="group" aria-label={t('editor.fold.level')} className="p-1">
        <div className="flex items-center gap-1">
          {HEADING_LEVELS.map((level, index) => {
            const Glyph = HEADING_GLYPHS[index];
            return (
              <button
                key={level}
                type="button"
                role="menuitemradio"
                aria-checked={flags.headingLevel === level}
                aria-label={`${t('editor.fold.headingLevel')} ${level}`}
                onClick={() => {
                  onSetHeading(level);
                  onClose();
                }}
                className="text-text hover:bg-hover flex size-7 shrink-0 items-center justify-center rounded aria-checked:bg-selected"
              >
                {Glyph !== undefined && <Icon glyph={Glyph} size="sm" />}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onSetHeading(0);
            onClose();
          }}
          className={ITEM_CLASS}
        >
          <Icon glyph={Pilcrow} size="sm" />
          {t('editor.context.paragraph')}
        </button>
      </div>

      <div className="bg-border my-1 h-px" role="separator" />

      {/* 2. Inline format — independent toggles. */}
      <div role="group" aria-label={t('editor.context.format')} className="p-1">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.bold}
          onClick={() => act('bold')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Bold} size="sm" />
          {t('editor.toolbar.bold')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.italic}
          onClick={() => act('italic')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Italic} size="sm" />
          {t('editor.toolbar.italic')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.strike}
          onClick={() => act('strike')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Strikethrough} size="sm" />
          {t('editor.toolbar.strike')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.link}
          onClick={() => act('link')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Link} size="sm" />
          {t('editor.toolbar.link')}
        </button>
      </div>

      <div className="bg-border my-1 h-px" role="separator" />

      {/* 3. Highlight — inline swatch row, exactly as `HighlightPalette`
          renders it, reporting through `onSetHighlight` rather than
          `onAction`: it is a colour choice, not a toggleable action name. */}
      <div
        role="group"
        aria-label={t('editor.highlight.palette')}
        className="flex items-center gap-1 p-2"
      >
        {HIGHLIGHT_CHOICES.map((choice) => (
          <button
            key={choice.color ?? 'default'}
            type="button"
            role="menuitemradio"
            aria-checked={choice.color === flags.highlightColor}
            aria-label={t(choice.label)}
            onClick={() => {
              onSetHighlight(choice.color);
              onClose();
            }}
            className={`size-5 shrink-0 rounded-full border border-border transition-[outline] duration-[var(--bear-duration-fast)] ease-bear aria-checked:outline-2 aria-checked:outline-offset-2 aria-checked:outline-accent ${choice.swatch}`}
          />
        ))}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <button
          type="button"
          role="menuitem"
          aria-label={t('editor.highlight.remove')}
          onClick={() => {
            onSetHighlight('remove');
            onClose();
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover hover:text-text"
        >
          <Icon glyph={Ban} size="sm" />
        </button>
      </div>

      <div className="bg-border my-1 h-px" role="separator" />

      {/* 4. Blocks — independent toggles, same as inline format. */}
      <div role="group" aria-label={t('editor.context.blocks')} className="p-1">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.bulletList}
          onClick={() => act('bulletList')}
          className={ITEM_CLASS}
        >
          <Icon glyph={List} size="sm" />
          {t('editor.toolbar.bulletList')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.orderedList}
          onClick={() => act('orderedList')}
          className={ITEM_CLASS}
        >
          <Icon glyph={ListOrdered} size="sm" />
          {t('editor.toolbar.orderedList')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.taskList}
          onClick={() => act('taskList')}
          className={ITEM_CLASS}
        >
          <Icon glyph={ListTodo} size="sm" />
          {t('editor.toolbar.checklist')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.codeBlock}
          onClick={() => act('codeBlock')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Code} size="sm" />
          {t('editor.toolbar.code')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={flags.blockquote}
          onClick={() => act('blockquote')}
          className={ITEM_CLASS}
        >
          <Icon glyph={Quote} size="sm" />
          {t('editor.toolbar.quote')}
        </button>
      </div>

      {/* 5. Table — one-shot actions, rendered only when the caret is
          inside a table. The three deletes carry `data-destructive` and the
          danger token, matching what the old floating bar did. */}
      {flags.table && (
        <>
          <div className="bg-border my-1 h-px" role="separator" />
          <div role="group" aria-label={t('editor.context.table')} className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => act('addRowBefore')}
              className={ITEM_CLASS}
            >
              <Icon glyph={Rows3} size="sm" />
              {t('editor.table.addRowBefore')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => act('addRowAfter')}
              className={ITEM_CLASS}
            >
              <Icon glyph={Rows3} size="sm" />
              {t('editor.table.addRowAfter')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => act('addColumnBefore')}
              className={ITEM_CLASS}
            >
              <Icon glyph={Columns3} size="sm" />
              {t('editor.table.addColumnBefore')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => act('addColumnAfter')}
              className={ITEM_CLASS}
            >
              <Icon glyph={Columns3} size="sm" />
              {t('editor.table.addColumnAfter')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-destructive=""
              onClick={() => act('deleteRow')}
              className={DESTRUCTIVE_CLASS}
            >
              <Icon glyph={Trash2} size="sm" />
              {t('editor.table.deleteRow')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-destructive=""
              onClick={() => act('deleteColumn')}
              className={DESTRUCTIVE_CLASS}
            >
              <Icon glyph={Trash2} size="sm" />
              {t('editor.table.deleteColumn')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-destructive=""
              onClick={() => act('deleteTable')}
              className={DESTRUCTIVE_CLASS}
            >
              <Icon glyph={Trash2} size="sm" />
              {t('editor.table.deleteTable')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
