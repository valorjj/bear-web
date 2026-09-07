import { useState, type ReactElement } from 'react';

import { canWriteTag, normalizeTag } from '@/data';
import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';

export interface TagRenamePopoverProps {
  /** The tag being renamed. Seeds the field. */
  tag: string;
  /** Viewport rect to anchor against — the row's own rect. */
  rect: DOMRect;
  /** Every tag currently in the tree, for the merge warning. */
  existingTags: readonly string[];
  /** Receives an ALREADY-NORMALIZED name. */
  onSubmit: (next: string) => void;
  onClose: () => void;
}

/**
 * The rename field, anchored at the row.
 *
 * A popover rather than a modal: it keeps the tree visible for context and has
 * room for the merge warning, and it is where S3's icon picker will live, so
 * the surface is built once. Validation goes through `normalizeTag` and
 * `canWriteTag` — never a rule list retyped here, which would be a second copy
 * of the tag grammar.
 */
export function TagRenamePopover({
  tag,
  rect,
  existingTags,
  onSubmit,
  onClose,
}: TagRenamePopoverProps): ReactElement {
  const t = useT();
  const [draft, setDraft] = useState(tag);
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(rect, onClose);

  const normalized = normalizeTag(draft);
  const valid = normalized !== null && canWriteTag(normalized);
  const merges = valid && normalized !== tag && existingTags.includes(normalized);

  function submit(): void {
    if (!valid || normalized === null) return;
    onSubmit(normalized);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('tags.rename.title')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      className="bg-surface border-border shadow-popover fixed z-20 w-64 rounded-md border p-2"
    >
      <label className="text-ui-sm text-muted block pb-1" htmlFor="tag-rename-field">
        {t('tags.rename.field')}
      </label>
      <input
        id="tag-rename-field"
        // The popover exists only to take this one value; opening it and not
        // focusing the field costs every user an extra click.
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submit();
        }}
        className="border-border bg-bg text-text text-ui w-full rounded-sm border px-2 py-1"
      />

      {!valid && draft.trim() !== '' && (
        <p className="text-ui-sm text-danger pt-1">{t('tags.rename.invalid')}</p>
      )}
      {merges && normalized !== null && (
        <p className="text-ui-sm text-muted pt-1">
          {t('tags.rename.merge').replace('{name}', normalized)}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-hover text-ui text-text rounded-sm px-2 py-1"
        >
          {t('tags.rename.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="hover:bg-hover text-ui text-text rounded-sm px-2 py-1 disabled:opacity-50"
        >
          {t('tags.rename.submit')}
        </button>
      </div>
    </div>
  );
}
