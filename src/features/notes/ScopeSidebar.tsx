import type { ReactElement } from 'react';

import { useT } from '@/i18n';

import { ACTIVE_SCOPE, type NoteScope, scopeKey, TRASHED_SCOPE } from './scope';

export interface ScopeSidebarProps {
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
}

/**
 * Two hardcoded rows, deliberately not a registry.
 *
 * M6 owns the smart-list sidebar and DELETES THIS FILE. It exists only so that
 * M3 can ship `trash` and `restore` with a path back — an app that can delete
 * a note but not recover it is not shippable, even temporarily. Do not grow
 * this into an abstraction; M6 replaces it wholesale.
 */
export function ScopeSidebar({ scope, onScopeChange }: ScopeSidebarProps): ReactElement {
  const t = useT();

  const rows: ReadonlyArray<{ id: string; scope: NoteScope; label: string }> = [
    { id: 'active', scope: ACTIVE_SCOPE, label: t('scope.notes') },
    { id: 'trashed', scope: TRASHED_SCOPE, label: t('scope.trash') },
  ];

  return (
    <nav aria-label={t('scope.label')} className="p-2">
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onScopeChange(row.scope)}
              aria-current={scopeKey(scope) === scopeKey(row.scope) ? 'page' : undefined}
              className={`w-full rounded px-2 py-1 text-left text-sm text-text ${
                scopeKey(scope) === scopeKey(row.scope) ? 'bg-bg' : 'hover:bg-bg'
              }`}
            >
              {row.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
