import { describe, expect, it } from 'vitest';

import { buildGraph, GHOST_PREFIX } from './buildGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string, updatedAt = NOW) => ({ id, title, updatedAt });

describe('buildGraph', () => {
  it('makes one node per active note, degree zero, when nothing links', () => {
    const graph = buildGraph([note('a', 'Alpha'), note('b', 'Beta')], []);

    expect(graph.nodes).toEqual([
      { id: 'a', title: 'Alpha', kind: 'note', degree: 0 },
      { id: 'b', title: 'Beta', kind: 'note', degree: 0 },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it('joins a link row to the note its title resolves to', () => {
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(graph.nodes.map((n) => n.degree)).toEqual([1, 1]);
  });

  it('mints a ghost node for a link no note answers', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'a', toTitle: 'kafka rebalancing' }]);

    expect(graph.nodes).toContainEqual({
      id: `${GHOST_PREFIX}kafka rebalancing`,
      title: 'kafka rebalancing',
      kind: 'ghost',
      degree: 1,
    });
  });

  it('collapses repeated links between the same pair into one edge', () => {
    // Two [[Beta]] mentions in one note, plus Beta linking back: one edge,
    // degree 1 each. Counting mentions would make the hub sizing a lie.
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'b', toTitle: 'alpha' },
      ],
    );

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(graph.nodes.map((n) => n.degree)).toEqual([1, 1]);
  });

  it('drops a note that links to itself', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'a', toTitle: 'alpha' }]);

    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0]!.degree).toBe(0);
  });

  it('drops a row whose source note is not in the index', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'trashed', toTitle: 'alpha' }]);

    expect(graph.edges).toEqual([]);
  });

  it('resolves a colliding title to the most recently updated note', () => {
    const graph = buildGraph(
      [note('src', 'Source'), note('old', 'Dup', NOW - 1000), note('new', 'Dup', NOW)],
      [{ noteId: 'src', toTitle: 'dup' }],
    );

    expect(graph.edges).toEqual([{ source: 'new', target: 'src' }]);
  });

  it('never emits an edge naming a node that does not exist', () => {
    // Load-bearing, not tidiness: forceLink THROWS on an unknown id, so a
    // ghost-minting bug would take the surface down rather than draw wrongly.
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'b', toTitle: 'nowhere' },
        { noteId: 'ghosted', toTitle: 'alpha' },
      ],
    );

    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source), `source ${edge.source}`).toBe(true);
      expect(ids.has(edge.target), `target ${edge.target}`).toBe(true);
    }
  });

  it('orders nodes and edges independently of input order', () => {
    // Determinism starts HERE, not in layoutGraph: d3 seeds initial positions
    // from array index, so a Dexie ordering change would otherwise reshuffle
    // the whole picture with no code change behind it.
    const forward = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );
    const reversed = buildGraph(
      [note('b', 'Beta'), note('a', 'Alpha')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );

    expect(reversed).toEqual(forward);
  });
});
