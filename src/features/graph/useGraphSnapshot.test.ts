import { describe, expect, it } from 'vitest';

import type { Graph } from './buildGraph';
import { capGraph } from './useGraphSnapshot';

const node = (id: string, degree: number): Graph['nodes'][number] => ({
  id,
  title: id,
  kind: 'note',
  degree,
});

describe('capGraph', () => {
  it('returns the graph unchanged when it is at or under the cap', () => {
    const full: Graph = {
      nodes: [node('a', 1), node('b', 1)],
      edges: [{ source: 'a', target: 'b' }],
    };

    expect(capGraph(full, 2)).toBe(full);
    expect(capGraph(full, 10)).toBe(full);
  });

  it('keeps the best-connected nodes and recomputes degree from surviving edges only', () => {
    // A hub ('a', degree 3 pre-cap) linked to three leaves. Capping to 2
    // keeps the hub plus its highest-priority neighbour by the same
    // degree/id tie-break `buildGraph` itself sorts by, and must drop the
    // other two edges along with the two dropped leaf nodes.
    const full: Graph = {
      nodes: [node('a', 3), node('leaf1', 1), node('leaf2', 1), node('leaf3', 1)],
      edges: [
        { source: 'a', target: 'leaf1' },
        { source: 'a', target: 'leaf2' },
        { source: 'a', target: 'leaf3' },
      ],
    };

    const result = capGraph(full, 2);

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'leaf1']);
    expect(result.edges).toEqual([{ source: 'a', target: 'leaf1' }]);
    // The hub's degree must drop from its pre-cap 3 to the 1 surviving edge
    // actually gives it — this is exactly the bug: a kept node whose
    // neighbours were dropped used to keep its stale, larger degree.
    expect(result.nodes.find((n) => n.id === 'a')?.degree).toBe(1);
    expect(result.nodes.find((n) => n.id === 'leaf1')?.degree).toBe(1);
  });

  it('zeroes the degree of a kept node whose only neighbour was dropped', () => {
    // All four nodes are degree 1, so the id tie-break decides who survives
    // a cap of 2: 'a' and 'c' sort ahead of their own respective partners
    // ('q' and 'r'), so the kept pair is two nodes that are NOT connected to
    // each other — their only edges each go to a node that got dropped.
    const full: Graph = {
      nodes: [node('a', 1), node('q', 1), node('c', 1), node('r', 1)],
      edges: [
        { source: 'a', target: 'q' },
        { source: 'c', target: 'r' },
      ],
    };

    const result = capGraph(full, 2);

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
    for (const n of result.nodes) {
      expect(n.degree).toBe(0);
    }
  });
});
