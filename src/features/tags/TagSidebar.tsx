import type { ReactElement } from 'react';

import { type NoteScope, scopeKey, tagScope } from '@/features/notes';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Hash, Icon } from '@/ui/Icon';
import { SidebarRow } from '@/ui/SidebarRow';

import type { TagNode } from './tagTree';

export interface TagSidebarProps {
  /** `undefined` while the tree is loading. Renders nothing, never an empty state. */
  nodes: TagNode[] | undefined;
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  isCollapsed: (tag: string) => boolean;
  onToggle: (tag: string) => void;
  /** Sizes rows for a finger. True wherever the sidebar is a drawer. */
  touch?: boolean;
}

interface RowProps extends Omit<TagSidebarProps, 'nodes'> {
  node: TagNode;
  depth: number;
}

function TagRow({ node, depth, scope, onScopeChange, isCollapsed, onToggle, touch }: RowProps) {
  const t = useT();
  const hasChildren = node.children.length > 0;
  const collapsed = isCollapsed(node.tag);
  const selected = scopeKey(scope) === scopeKey(tagScope(node.tag));

  return (
    <SidebarRow
      label={node.label}
      count={node.count}
      depth={depth}
      icon={<Icon glyph={Hash} size={touch ? 'md' : 'sm'} />}
      touch={touch}
      selected={selected}
      onSelect={() => onScopeChange(tagScope(node.tag))}
      disclosure={
        hasChildren
          ? { expanded: !collapsed, onToggle: () => onToggle(node.tag), label: t('tags.toggle') }
          : undefined
      }
    >
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
              touch={touch}
            />
          ))}
        </ul>
      )}
    </SidebarRow>
  );
}

export function TagSidebar({
  nodes,
  scope,
  onScopeChange,
  isCollapsed,
  onToggle,
  touch = false,
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
            touch={touch}
          />
        ))}
      </ul>
    </nav>
  );
}
