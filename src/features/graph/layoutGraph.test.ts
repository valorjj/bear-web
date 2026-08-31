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
});
