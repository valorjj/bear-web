import { useEffect, useState } from 'react';

import { notes } from '@/data';

import { buildGraph, type Graph } from './buildGraph';
import type { Point } from './layoutGraph';
import { runLayout } from './runLayout';

/** Above this, the surface says what it is showing instead of hanging. */
export const NODE_CAP = 2000;

export type GraphSnapshot =
  | { status: 'building' }
  | { status: 'settling'; graph: Graph }
  | { status: 'ready'; graph: Graph; positions: Map<string, Point>; capped: number }
  | { status: 'empty' };

let cachedHash: string | null = null;
let cachedPositions: Map<string, Point> | null = null;

function topologyHash(graph: Graph): string {
  return `${graph.nodes.map((n) => n.id).join(',')}|${graph.edges
    .map((e) => `${e.source}>${e.target}`)
    .join(',')}`;
}

/**
 * Keep the `cap` best-connected nodes of `full` (by pre-cap degree, an
 * arbitrary slice would hide exactly the hubs this surface exists to show),
 * and every edge between two surviving nodes.
 *
 * Degree on the RETURNED nodes is recomputed from the surviving edges, not
 * carried over from `full`. A kept node whose neighbours were dropped
 * otherwise keeps its pre-cap degree: it renders oversized (`nodeRadius`
 * scales with degree), ranks wrongly in the hubs list, and a genuinely
 * now-unlinked node escapes the `unlinked` count in the canvas's accessible
 * name.
 *
 * Pure, so the recomputation can be tested directly rather than only through
 * a 2,000+-note snapshot fixture.
 */
export function capGraph(full: Graph, cap: number): Graph {
  if (full.nodes.length <= cap) return full;

  const keep = new Set(
    [...full.nodes]
      .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))
      .slice(0, cap)
      .map((n) => n.id),
  );
  const edges = full.edges.filter((e) => keep.has(e.source) && keep.has(e.target));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  return {
    nodes: full.nodes
      .filter((n) => keep.has(n.id))
      .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
    edges,
  };
}

/**
 * Read the vault once, project it, and settle it.
 *
 * A SNAPSHOT, not a `useLiveQuery` subscription, and that is deliberate — see
 * `docs/rulings/notes-lifecycle.md`. Relayout is not incremental: every node
 * moves. A live graph would therefore rearrange itself under the reader's
 * cursor, for up to two seconds, because a note they cannot even see was
 * autosaved. No note is editable while this surface is open, so the only thing
 * that can change the vault underneath it is a sync pull. Reopening
 * re-snapshots.
 *
 * Positions are cached in module scope by topology hash, so reopening after
 * editing nothing is instant and reopening after adding one note recomputes.
 */
export function useGraphSnapshot(): GraphSnapshot {
  const [snapshot, setSnapshot] = useState<GraphSnapshot>({ status: 'building' });

  useEffect(() => {
    let live = true;

    void (async () => {
      const [index, rows] = await Promise.all([notes.allNoteIndex(), notes.allLinkRows()]);
      if (!live) return;

      if (index.length === 0) {
        setSnapshot({ status: 'empty' });
        return;
      }

      const full = buildGraph(index, rows);
      const capped = Math.max(0, full.nodes.length - NODE_CAP);
      const graph = capGraph(full, NODE_CAP);

      setSnapshot({ status: 'settling', graph });

      const hash = topologyHash(graph);
      if (cachedHash === hash && cachedPositions !== null) {
        setSnapshot({ status: 'ready', graph, positions: cachedPositions, capped });
        return;
      }

      const positions = await runLayout(graph);
      if (!live) return;

      cachedHash = hash;
      cachedPositions = positions;
      setSnapshot({ status: 'ready', graph, positions, capped });
    })();

    return () => {
      live = false;
    };
  }, []);

  return snapshot;
}
