import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { SidebarRow } from '@/ui/SidebarRow';

import { type NoteScope, scopeKey, SMART_LIST_IDS, type SmartListId, smartScope } from './scope';
import type { SmartListCounts } from './useSmartListCounts';

export interface SmartListSidebarProps {
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  /** `undefined` while the counts query has not resolved. Rows still render. */
  counts: SmartListCounts | undefined;
}

/**
 * Replaces `ScopeSidebar`, which shipped in M3 as two hardcoded rows with a
 * comment saying M6 would delete it. It has.
 */
const LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};

export function SmartListSidebar({
  scope,
  onScopeChange,
  counts,
}: SmartListSidebarProps): ReactElement {
  const t = useT();
  const active = scopeKey(scope);

  return (
    <nav aria-label={t('smartList.label')} className="p-2">
      <ul>
        {SMART_LIST_IDS.map((id) => {
          const rowScope = smartScope(id);
          return (
            <SidebarRow
              key={id}
              label={t(LABELS[id])}
              // `counts?.[id]` rather than `counts && counts[id]`: the latter
              // is `undefined` for a genuine zero only by accident of
              // falsiness, and a zero count must render as "0".
              count={counts?.[id]}
              selected={active === scopeKey(rowScope)}
              onSelect={() => onScopeChange(rowScope)}
            />
          );
        })}
      </ul>
    </nav>
  );
}
