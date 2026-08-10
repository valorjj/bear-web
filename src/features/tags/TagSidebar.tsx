import type { ReactElement } from 'react';

import { type NoteScope, scopeKey, tagScope } from '@/features/notes';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';

import type { TagNode } from './tagTree';

export interface TagSidebarProps {
  /** `undefined` while the tree is loading. Renders nothing, never an empty state. */
  nodes: TagNode[] | undefined;
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  isCollapsed: (tag: string) => boolean;
  onToggle: (tag: string) => void;
}

interface RowProps extends Omit<TagSidebarProps, 'nodes'> {
  node: TagNode;
  depth: number;
}

function TagRow({ node, depth, scope, onScopeChange, isCollapsed, onToggle }: RowProps) {
  const t = useT();
  const hasChildren = node.children.length > 0;
  const collapsed = isCollapsed(node.tag);
  const selected = scopeKey(scope) === scopeKey(tagScope(node.tag));

  return (
    <li>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            type="button"
            aria-label={t('tags.toggle')}
            onClick={() => onToggle(node.tag)}
            className="shrink-0 rounded px-1 text-xs text-muted hover:bg-bg"
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="shrink-0 px-1 text-xs" aria-hidden="true">
            {' '}
          </span>
        )}

        <button
          type="button"
          onClick={() => onScopeChange(tagScope(node.tag))}
          aria-current={selected ? 'page' : undefined}
          aria-expanded={hasChildren ? !collapsed : undefined}
          style={{ paddingLeft: `${depth * 0.75}rem` }}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm text-text ${
            selected ? 'bg-bg' : 'hover:bg-bg'
          }`}
        >
          <span className="truncate">{node.label}</span>{' '}
          <span className="shrink-0 text-xs text-muted">{node.count}</span>
        </button>
      </div>

      {hasChildren && !collapsed && (
        <ul>
          {node.children.map((child) => (
            <TagRow
              key={child.tag}
              node={child}
              depth={depth + 1}
              scope={scope}
              onScopeChange={onScopeChange}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TagSidebar({
  nodes,
  scope,
  onScopeChange,
  isCollapsed,
  onToggle,
}: TagSidebarProps): ReactElement | null {
  const t = useT();

  // `undefined` is "not loaded yet", not "no tags". Showing the empty state on
  // the first frame would flash "No tags yet" on every reload.
  if (nodes === undefined) return null;

  if (nodes.length === 0) {
    return <EmptyState title={t('sidebar.empty.title')} body={t('sidebar.empty.body')} />;
  }

  return (
    <nav aria-label={t('tags.label')} className="p-2">
      <ul>
        {nodes.map((node) => (
          <TagRow
            key={node.tag}
            node={node}
            depth={0}
            scope={scope}
            onScopeChange={onScopeChange}
            isCollapsed={isCollapsed}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </nav>
  );
}
