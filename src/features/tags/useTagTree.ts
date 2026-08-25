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

  // Writes `collapsed: false` for every ancestor UNCONDITIONALLY, and the
  // absence of a `collapsed.has(ancestor)` guard is the whole point.
  //
  // The guard that used to be here read `collapsed`, which is derived from a
  // live query — so `reveal` was a read-modify-write against a cache that can
  // lag the database it is deciding about. When it lagged, `reveal` wrote
  // NOTHING and the ancestor stayed shut: the row the caller asked to reveal
  // never rendered at all, silently and permanently, rather than late. That is
  // a real user-facing failure (Mod-click a nested tag pill within a frame of
  // collapsing its parent and nothing happens) and it is what made
  // `AppShell.test.tsx`'s "reveals a collapsed ancestor" test flake on loaded
  // CI runners three times, each previously mis-diagnosed as a slow wait and
  // patched with a bigger timeout — a ceiling cannot fix a write that was
  // never issued. Verified by injection: forcing the guard's set to be empty
  // reproduces that test's exact CI error, `Unable to find role="button" and
  // name /^urgent\b/`, after exhausting its full 5000ms ceiling.
  //
  // The cost is one idempotent `put` per already-expanded ancestor. `reveal`
  // no longer depends on `collapsed` at all, so it is also stable across
  // renders, which the guard version never was.
  const reveal = useCallback((tag: string) => {
    const segments = tag.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      void tags.setCollapsed(segments.slice(0, i).join('/'), false);
    }
  }, []);

  return { nodes, isCollapsed, toggle, reveal };
}
