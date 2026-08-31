import { buildTitleIndex, normalizeTitle, type NoteLink, type TitledNote } from '@/data';

/** Prefixes a ghost node's id, so it can never collide with a note id. */
export const GHOST_PREFIX = 'ghost:';

export interface GraphNode {
  /** A note id, or `ghost:<normalized title>`. */
  id: string;
  /** What the label shows: the note's own title, or the unresolved link text. */
  title: string;
  kind: 'note' | 'ghost';
  /** Distinct neighbours. Sizes the node; see `nodeRadius`. */
  degree: number;
}

export interface GraphEdge {
  /** Normalized so `source <= target`, which is what makes dedup possible. */
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The whole vault as an undirected graph: one node per active note, one ghost
 * node per `[[link]]` nothing answers, one edge per distinct pair.
 *
 * Three properties this guarantees, each with a test and a reason:
 *
 * - **Every edge endpoint exists as a node.** `forceLink` throws on an id it
 *   cannot find, so violating this takes the surface down rather than drawing
 *   it wrongly.
 * - **Output order does not depend on input order.** `d3-force` seeds initial
 *   positions from array index, so ordering IS layout. Sorting here is what
 *   lets `npm run shots` screenshot a stable picture.
 * - **Edges are distinct pairs, not mentions.** Three `[[Beta]]`s in one note
 *   is one relationship; counting them would make hub sizing a lie.
 *
 * Direction is discarded deliberately (see the spec): arrowheads at 1000 nodes
 * are unreadable until zoomed far enough in that the overview is gone.
 */
export function buildGraph(index: readonly TitledNote[], rows: readonly NoteLink[]): Graph {
  const byTitle = buildTitleIndex(index);
  const nodes = new Map<string, GraphNode>();

  for (const note of index) {
    nodes.set(note.id, { id: note.id, title: note.title, kind: 'note', degree: 0 });
  }

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const row of rows) {
    // A row whose source is absent means the index is momentarily ahead of the
    // notes table (a trash mid-read). Skip rather than mint a node for it.
    if (!nodes.has(row.noteId)) continue;

    const key = normalizeTitle(row.toTitle);
    const resolved = byTitle.get(key);
    let targetId: string;

    if (resolved === undefined) {
      targetId = `${GHOST_PREFIX}${key}`;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, { id: targetId, title: key, kind: 'ghost', degree: 0 });
      }
    } else {
      targetId = resolved.id;
    }

    if (targetId === row.noteId) continue;

    const [source, target] =
      row.noteId < targetId ? [row.noteId, targetId] : [targetId, row.noteId];
    // `\u0000` and not a space: a ghost id is `ghost:<title>` and titles
    // contain spaces, so a space separator makes `ghost:a` + `b c` and
    // `ghost:a b` + `c` the same key — two distinct pairs silently
    // collapsing into one edge. NUL cannot appear in either id.
    const pair = `${source}\u0000${target}`;
    if (seen.has(pair)) continue;

    seen.add(pair);
    edges.push({ source, target });
    nodes.get(source)!.degree += 1;
    nodes.get(target)!.degree += 1;
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: edges.sort((a, b) =>
      a.source === b.source
        ? a.target < b.target
          ? -1
          : a.target > b.target
            ? 1
            : 0
        : a.source < b.source
          ? -1
          : 1,
    ),
  };
}
