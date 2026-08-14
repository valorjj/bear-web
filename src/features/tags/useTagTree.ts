import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';

import { notes, tags } from '@/data';

import { buildTagTree, type TagNode } from './tagTree';

export interface TagTreeState {
  /** `undefined` while the live query has not resolved. Never treat it as empty. */
  nodes: TagNode[] | undefined;
  isCollapsed: (tag: string) => boolean;
  toggle: (tag: string) => void;
  /**
   * Opens every collapsed ancestor of `tag`, so its row is actually rendered.
   *
   * The tag itself keeps its own disclosure state: revealing `work` means
   * "show me that row", not "expand what hangs off it".
   */
  reveal: (tag: string) => void;
}

export function useTagTree(): TagTreeState {
  // Both queries have a constant `[]` dependency array, so the stale-previous-
  // value hazard documented in CLAUDE.md does not apply and no result tagging
  // is needed here.
  const rows = useLiveQuery(() => notes.allTagRows(), []);
  const meta = useLiveQuery(() => tags.allMeta(), []);

  // Memoized on `rows`' identity: `dexie-react-hooks`' `useLiveQuery` gives a
  // fresh array only when the underlying query result actually changes, so
  // without this `buildTagTree` re-ran, and gave `tree.nodes` a fresh
  // identity, on every `AppShell` render — including ones with no tag
  // change — which in turn made `AppShell`'s vanished-tag effect re-walk the
  // whole tree on every render too.
  const nodes = useMemo(() => (rows === undefined ? undefined : buildTagTree(rows)), [rows]);

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

  const reveal = useCallback(
    (tag: string) => {
      const segments = tag.split('/');
      for (let i = 1; i < segments.length; i += 1) {
        const ancestor = segments.slice(0, i).join('/');
        if (collapsed.has(ancestor)) void tags.setCollapsed(ancestor, false);
      }
    },
    [collapsed],
  );

  return { nodes, isCollapsed, toggle, reveal };
}
