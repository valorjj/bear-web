import { describe, expect, it } from 'vitest';

import { buildGraph } from './buildGraph';
import { layoutGraph } from './layoutGraph';
import { runLayout, WORKER_THRESHOLD } from './runLayout';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

describe('runLayout', () => {
  it('matches layoutGraph exactly below the worker threshold', async () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B')], [{ noteId: 'a', toTitle: 'b' }]);

    expect([...(await runLayout(graph))]).toEqual([...layoutGraph(graph)]);
  });

  it('falls back to the synchronous path when no Worker exists', async () => {
    // jsdom has no `Worker` at all, so this IS the environment the fallback
    // exists for — and it is why every unit test here exercises the
    // synchronous half. The worker path belongs to e2e/graph.spec.ts.
    const index = Array.from({ length: WORKER_THRESHOLD + 5 }, (_, i) =>
      note(`n${String(i).padStart(4, '0')}`, `N${i}`),
    );
    const graph = buildGraph(index, []);

    const positions = await runLayout(graph);

    expect(positions.size).toBe(graph.nodes.length);
    for (const point of positions.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });
});
