import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';

import { notes, tags } from '@/data';

import { buildTagTree, type TagNode } from './tagTree';

export interface TagTreeState {
  /** `undefined` while the live query has not resolved. Never treat it as empty. */
  nodes: TagNode[] | undefined;
  isCollapsed: (tag: string) => boolean;
  toggle: (tag: string) => void;
}

export function useTagTree(): TagTreeState {
  // Both queries have a constant `[]` dependency array, so the stale-previous-
  // value hazard documented in CLAUDE.md does not apply and no result tagging
  // is needed here.
  const rows = useLiveQuery(() => notes.allTagRows(), []);
  const meta = useLiveQuery(() => tags.allMeta(), []);

  const nodes = rows === undefined ? undefined : buildTagTree(rows);

  const collapsed = useMemo(
    () => new Set((meta ?? []).filter((m) => m.collapsed).map((m) => m.tag)),
    [meta],
  );

  const isCollapsed = useCallback((tag: string) => collapsed.has(tag), [collapsed]);

  const toggle = useCallback(
    (tag: string) => {
      void tags.setCollapsed(tag, !collapsed.has(tag));
    },
    [collapsed],
  );

  return { nodes, isCollapsed, toggle };
}
