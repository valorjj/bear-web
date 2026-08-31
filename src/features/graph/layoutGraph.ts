import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';

import type { Graph } from './buildGraph';
import { nodeRadius } from './nodeRadius';

export interface Point {
  x: number;
  y: number;
}

/** Enough for the layout to settle at every size in the supported range. */
export const LAYOUT_TICKS = 300;

/**
 * Fixed, arbitrary, and the reason two runs agree. Changing it reshuffles
 * every user's graph, so treat it as a constant with a user-visible effect.
 */
const SEED = 0x5eed;

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

/**
 * A linear congruential generator, standing in for `Math.random`.
 *
 * `d3-force`'s only randomness is `jiggle()` — `(random() - 0.5) * 1e-6`,
 * applied by `forceLink` and `forceCollide` when two nodes coincide exactly.
 * `simulation.randomSource()` replaces the source for every force the
 * simulation owns, and initial placement is phyllotaxis, already
 * deterministic. Those two facts together are what make the output stable.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Settle `graph` to fixed positions, centred on the origin.
 *
 * Pure and synchronous: no React, no DOM, no `Worker`. That is deliberate —
 * jsdom has no `Worker` at all, so a worker-only design would push the only
 * part of L3 with real math in it into Playwright. `runLayout` decides where
 * this runs; this function only knows how.
 */
export function layoutGraph(graph: Graph): Map<string, Point> {
  const nodes: SimNode[] = graph.nodes.map((node) => ({
    id: node.id,
    radius: nodeRadius(node.degree),
  }));
  const links = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(nodes)
    .randomSource(seededRandom(SEED))
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((node) => node.id)
        .distance(40),
    )
    .force('charge', forceManyBody().strength(-120))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<SimNode>().radius((node) => node.radius + 2),
    )
    .stop();

  for (let i = 0; i < LAYOUT_TICKS; i += 1) simulation.tick();

  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
}
