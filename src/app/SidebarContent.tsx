import type { ReactElement } from 'react';

import { AccountMenu } from '@/features/account';
import { ThemePicker } from '@/features/appearance';
import type { NoteScope } from '@/features/notes';
import { SmartListSidebar } from '@/features/notes';
import type { SmartListCounts } from '@/features/notes';
import { TagSidebar } from '@/features/tags';
import type { TagNode } from '@/features/tags';

export interface SidebarContentProps {
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  /** `undefined` while the counts query has not resolved. Rows still render. */
  counts: SmartListCounts | undefined;
  /** `undefined` while the tree is loading. Renders nothing, never an empty state. */
  nodes: TagNode[] | undefined;
  isCollapsed: (tag: string) => boolean;
  onToggle: (tag: string) => void;
  /** Sizes rows for a finger. True in the drawer, false in the desktop pane. */
  touch?: boolean;
}

/**
 * The sidebar's insides: smart lists, the tag tree, and the footer.
 *
 * Extracted from `AppShell` verbatim when the drawer arrived, so the desktop
 * pane and the phone/tablet drawer render the SAME component. There is no
 * mobile variant of the tag tree to keep in step with this one, which is the
 * point of the extraction — a second copy would drift the moment either
 * changed.
 */
export function SidebarContent({
  scope,
  onScopeChange,
  counts,
  nodes,
  isCollapsed,
  onToggle,
  touch = false,
}: SidebarContentProps): ReactElement {
  return (
    <>
      {/*
        The scroller is inner, not the pane or the drawer itself, so the footer
        stays pinned while the tag tree scrolls under it.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SmartListSidebar
          scope={scope}
          onScopeChange={onScopeChange}
          counts={counts}
          touch={touch}
        />
        <TagSidebar
          nodes={nodes}
          scope={scope}
          onScopeChange={onScopeChange}
          isCollapsed={isCollapsed}
          onToggle={onToggle}
          touch={touch}
        />
      </div>

      <div className="border-border flex shrink-0 items-center gap-1 border-t p-1">
        <ThemePicker />
        <AccountMenu />
      </div>
    </>
  );
}
