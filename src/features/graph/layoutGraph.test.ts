import { describe, expect, it } from 'vitest';

import { buildGraph } from './buildGraph';
import { layoutGraph } from './layoutGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

function fixture() {
  const index = Array.from({ length: 40 }, (_, i) =>
    note(`n${String(i).padStart(2, '0')}`, `N${i}`),
  );
  const rows = Array.from({ length: 60 }, (_, i) => ({
    noteId: `n${String(i % 40).padStart(2, '0')}`,
    toTitle: `n${(i * 7 + 3) % 40}`,
  }));
  return buildGraph(index, rows);
}

const fingerprint = (positions: Map<string, { x: number; y: number }>) =>
  [...positions].map(([id, p]) => `${id}:${p.x.toFixed(6)},${p.y.toFixed(6)}`).join('|');

/** A small, fixed graph for the golden-fingerprint test: 7 notes, one ghost. */
function goldenFixture() {
  const index = Array.from({ length: 7 }, (_, i) => note(`n${i}`, `N${i}`));
  const rows = [
    { noteId: 'n0', toTitle: 'N1' },
    { noteId: 'n1', toTitle: 'N2' },
    { noteId: 'n2', toTitle: 'N0' },
    { noteId: 'n3', toTitle: 'N4' },
    { noteId: 'n4', toTitle: 'N5' },
    { noteId: 'n5', toTitle: 'Nowhere' },
  ];
  return buildGraph(index, rows);
}

describe('layoutGraph', () => {
  it('lays the same graph out identically every time', () => {
    // This is what makes the graph screenshottable by `npm run shots`, which
    // is the only thing in this repo that can see "renders wrong". d3-force's
    // only randomness is jiggle(); randomSource() replaces it for every force
    // the simulation owns.
    expect(fingerprint(layoutGraph(fixture()))).toBe(fingerprint(layoutGraph(fixture())));
  });

  it('gives every node a finite coordinate', () => {
    // A NaN position renders as an invisible node with NO error and NO crash —
    // the same silent shape as parseColour's NaN and an unmapped .hljs-* class.
    // It passes every assertion that is not this one.
    for (const [id, point] of layoutGraph(fixture())) {
      expect(Number.isFinite(point.x), `${id}.x`).toBe(true);
      expect(Number.isFinite(point.y), `${id}.y`).toBe(true);
    }
  });

  it('separates two nodes that would otherwise start coincident', () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B')], [{ noteId: 'a', toTitle: 'b' }]);

    const positions = layoutGraph(graph);
    const a = positions.get('a')!;
    const b = positions.get('b')!;

    expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('places every node of an edgeless graph', () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B'), note('c', 'C')], []);

    expect(layoutGraph(graph).size).toBe(3);
  });

  it('does not throw on a graph containing ghost nodes', () => {
    const graph = buildGraph([note('a', 'A')], [{ noteId: 'a', toTitle: 'nowhere at all' }]);

    expect(() => layoutGraph(graph)).not.toThrow();
    expect(layoutGraph(graph).size).toBe(2);
  });

  it('lays out a fixed small graph to an exact, committed fingerprint', () => {
    // This is the test that actually protects the screenshot story: it fails
    // on a tick-count change, a force-parameter change, or a node-ordering
    // change — the things that genuinely reshuffle every user's graph. The
    // "same graph twice" test above cannot see any of those, since both runs
    // share the same build.
    const golden =
      'ghost:nowhere:97.737916,153.910363|n0:-114.821358,-1.878340|n1:-88.621399,-45.192160|' +
      'n2:-65.726398,-1.646604|n3:133.217057,14.559828|n4:113.595565,57.905068|' +
      'n5:92.319448,107.162299|n6:-167.704036,-284.820148';

    expect(fingerprint(layoutGraph(goldenFixture()))).toBe(golden);
  });
});
