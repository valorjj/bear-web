import LayoutWorker from './layoutWorker?worker';

import type { Graph } from './buildGraph';
import { layoutGraph, type Point } from './layoutGraph';

/**
 * Above this many nodes the simulation moves off the main thread.
 *
 * Measured on this machine on 2026-08-31, median of 5 runs at 300 ticks:
 * 200 nodes 121 ms, 300 nodes 202 ms, **400 nodes 262 ms**, 500 nodes 339 ms,
 * 800 nodes 581 ms. 400 is the last size whose settle stays inside the
 * ~250-300 ms a user reads as "instant" rather than "stalled". Those figures
 * are from Node and measure the simulation alone; in the browser the same
 * ticks compete with paint, so treat them as a floor.
 */
export const WORKER_THRESHOLD = 400;

function layoutInWorker(graph: Graph): Promise<Map<string, Point>> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      // Vite resolves `?worker` at build time into a separate chunk. `types:
      // ["vite/client"]` in tsconfig.app.json is what makes this typecheck.
      worker = new LayoutWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    worker.addEventListener('message', (event: MessageEvent<[string, Point][]>) => {
      resolve(new Map(event.data));
      worker.terminate();
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message));
    });

    worker.postMessage(graph);
  });
}

/**
 * Settle `graph`, on the main thread or in a worker depending on its size.
 *
 * A worker that will not start — no `Worker` global under jsdom, a blocked
 * chunk, a CSP — falls back to the synchronous path rather than surfacing an
 * error. The fallback runs the SAME function, so the only cost is a frozen
 * second; an error dialog would be a worse trade for the user than a pause.
 */
export async function runLayout(graph: Graph): Promise<Map<string, Point>> {
  if (graph.nodes.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return layoutGraph(graph);
  }

  try {
    return await layoutInWorker(graph);
  } catch {
    return layoutGraph(graph);
  }
}
