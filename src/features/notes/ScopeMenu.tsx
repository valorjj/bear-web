import { type KeyboardEvent, type ReactElement, useRef } from 'react';

import type { NoteOrder, NoteOrderField } from '@/data';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';

import { PREVIEW_SIZES, type PreviewSize } from './preview';
import {
  isTrash,
  type NoteScope,
  type ScopeQuery,
  scopeKey,
  SMART_LIST_IDS,
  type SmartListId,
  smartScope,
} from './scope';

/**
 * The digit each builtin answers to, with `⇧⌘`. Exported so `useScopeShortcuts`
 * binds exactly what this menu advertises — a hint and a handler that disagree
 * is the failure this constant exists to make impossible.
 *
 * Follows `SMART_LIST_IDS` order, NOT Bear's: Bear puts 잠긴항목 at 5 and 고정됨
 * at 6, and our sidebar has always run pinned before locked. A digit that
 * disagreed with the row above it would be worse than one that disagrees with
 * another app.
 *
 * 7, 8 and 9 are deliberately unassigned — `@tiptap` binds `Mod-Shift-7/8/9`
 * to ordered list, bullet list and blockquote. A future Archive list therefore
 * cannot take `⇧⌘9`, which is the slot Bear uses for it.
 */
export const SCOPE_SHORTCUT_DIGITS: Record<SmartListId, string> = {
  all: '1',
  untagged: '2',
  todo: '3',
  today: '4',
  pinned: '5',
  locked: '6',
  trash: '0',
};

const SORT_FIELDS: readonly { field: NoteOrderField; label: TranslationKey }[] = [
  { field: 'updated', label: 'noteList.sort.updated' },
  { field: 'created', label: 'noteList.sort.created' },
  { field: 'title', label: 'noteList.sort.title' },
];

const PREVIEW_LABELS: Record<PreviewSize, TranslationKey> = {
  small: 'noteList.preview.small',
  medium: 'noteList.preview.medium',
  large: 'noteList.preview.large',
};

const SMART_LIST_LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};

export interface ScopeMenuProps {
  scope: NoteScope;
  /** From the UNFILTERED scope list, never the query-narrowed view. */
  count: number;
  /** Named `scopeQuery`, never `query`: `NoteList` already has a `query`
   *  string for the SEARCH field, and the two collided once. */
  scopeQuery: ScopeQuery;
  previewSize: PreviewSize;
  onOrderChange: (next: NoteOrder) => void;
  onPreviewSizeChange: (next: PreviewSize) => void;
  /** Receives the new `includeDescendants`, not the checkbox's own state. */
  onIncludeDescendantsChange: (next: boolean) => void;
  onScopeChange: (next: NoteScope) => void;
}

const ROW =
  'ease-bear flex w-full items-center justify-between gap-4 rounded-sm px-2 py-1 text-left text-ui text-text transition-colors duration-[var(--bear-duration-fast)] enabled:hover:bg-hover disabled:text-faint';

const NOTE = 'px-2 py-1 text-ui-xs text-faint';

const CHECK = 'text-accent';

/**
 * The note list's options: a count, the sort order, the preview density, the
 * sub-tag filter, and every builtin scope with its shortcut.
 *
 * Flat, not nested. Bear nests its sort and preview submenus; nesting costs
 * hover-intent timing, a second placement layer and focus return on close, and
 * none of it is unit-testable because jsdom has no layout engine to place a
 * submenu against. Sixteen rows flat is shorter than the scope list Bear
 * already shows unnested.
 *
 * The checkmarks Bear draws are structure here: `menuitemradio` with
 * `aria-checked` for one-of-N choices, `menuitemcheckbox` for the two toggles.
 * The ✓ glyph is `aria-hidden` decoration on top of that, never the signal.
 *
 * Placement is the caller's job, like every other floating surface — see
 * `RichEditor` and `ExportMenu`.
 */
export function ScopeMenu({
  scope,
  count,
  scopeQuery,
  previewSize,
  onOrderChange,
  onPreviewSizeChange,
  onIncludeDescendantsChange,
  onScopeChange,
}: ScopeMenuProps): ReactElement {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  const trash = isTrash(scope);
  const isTagScope = scope.kind === 'tag';
  const hidingSubTags = !scopeQuery.includeDescendants;

  /**
   * Roving movement over the ENABLED rows only, so a disabled group is a
   * skipped region rather than a dead stop. Sixteen rows need this; the
   * three-row `ExportMenu` did not, which is why it lives here rather than
   * being shared.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const rows = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    if (rows.length === 0) return;

    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;

    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowDown') next = (current + 1) % rows.length;
    else next = (current - 1 + rows.length) % rows.length;

    event.preventDefault();
    rows[next]?.focus();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('noteList.menu.label')}
      onKeyDown={onKeyDown}
      className="flex min-w-56 flex-col gap-0.5"
    >
      {/* Presentational: a count is not an action, and a focus stop on it would
          cost an extra keypress on every arrow-key pass through the menu. */}
      <div aria-hidden="true" className={NOTE}>
        {count === 1
          ? t('noteList.count.one')
          : t('noteList.count.other').replace('{count}', String(count))}
      </div>

      <hr className="border-border my-1" />

      {SORT_FIELDS.map(({ field, label }) => {
        const checked = scopeQuery.order.field === field;
        return (
          <button
            key={field}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            disabled={trash}
            onClick={() => onOrderChange({ ...scopeQuery.order, field })}
            className={ROW}
          >
            {t(label)}
            {checked && (
              <span aria-hidden="true" className={CHECK}>
                ✓
              </span>
            )}
          </button>
        );
      })}

      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={scopeQuery.order.newestFirst}
        disabled={trash}
        onClick={() =>
          onOrderChange({ ...scopeQuery.order, newestFirst: !scopeQuery.order.newestFirst })
        }
        className={ROW}
      >
        {t('noteList.sort.newestFirst')}
        {scopeQuery.order.newestFirst && (
          <span aria-hidden="true" className={CHECK}>
            ✓
          </span>
        )}
      </button>

      {/* A disabled control whose reason is invisible is the defect B1 rejected
          the pane-width threshold over, and deferred.md records the same rule
          against the title-line affordance. The copy is not decoration. */}
      {trash && <p className={NOTE}>{t('noteList.sort.trashNote')}</p>}

      <hr className="border-border my-1" />

      {PREVIEW_SIZES.map((size) => {
        const checked = previewSize === size;
        return (
          <button
            key={size}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            onClick={() => onPreviewSizeChange(size)}
            className={ROW}
          >
            {t(PREVIEW_LABELS[size])}
            {checked && (
              <span aria-hidden="true" className={CHECK}>
                ✓
              </span>
            )}
          </button>
        );
      })}

      {/* The checkbox reads "hide", the data reads "include", so the two are
          inverses of each other. Reported as the new `includeDescendants` so
          the caller never has to re-invert it. */}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={hidingSubTags}
        disabled={!isTagScope}
        onClick={() => onIncludeDescendantsChange(hidingSubTags)}
        className={ROW}
      >
        {t('noteList.preview.hideSubTags')}
        {hidingSubTags && (
          <span aria-hidden="true" className={CHECK}>
            ✓
          </span>
        )}
      </button>

      {!isTagScope && <p className={NOTE}>{t('noteList.preview.hideSubTagsNote')}</p>}

      <hr className="border-border my-1" />

      {/* Generated from SMART_LIST_IDS, never hand-listed. M6 deleted
          ScopeSidebar precisely because it hardcoded its rows, and
          SmartListSidebar renders all seven builtins as data; a second surface
          listing the same scopes must not reintroduce the registry-grown-row-
          by-row shape. Adding a builtin stays a one-line change in scope.ts. */}
      {SMART_LIST_IDS.map((list) => {
        const target = smartScope(list);
        const checked = scopeKey(scope) === scopeKey(target);
        return (
          <button
            key={list}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            onClick={() => onScopeChange(target)}
            className={ROW}
          >
            {t(SMART_LIST_LABELS[list])}
            <span aria-hidden="true" className="text-faint">
              ⇧⌘{SCOPE_SHORTCUT_DIGITS[list]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
