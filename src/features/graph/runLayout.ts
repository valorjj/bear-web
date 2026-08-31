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

/** Wall-clock ceiling on a worker reply. ~15x the measured 2,000-node settle. */
export const WORKER_TIMEOUT_MS = 30_000;

/**
 * The narrow slice of `Worker` this module actually uses, so a fake can stand
 * in for it in tests — jsdom has no real `Worker` at all.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}

/** Defaults to the real worker; a test injects a fake in its place. */
function defaultWorkerFactory(): WorkerLike {
  // Vite resolves `?worker` at build time into a separate chunk. `types:
  // ["vite/client"]` in tsconfig.app.json is what makes this typecheck.
  return new LayoutWorker();
}

function layoutInWorker(
  graph: Graph,
  createWorker: () => WorkerLike = defaultWorkerFactory,
): Promise<Map<string, Point>> {
  return new Promise((resolve, reject) => {
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('layoutInWorker timed out'));
    }, WORKER_TIMEOUT_MS);

    worker.addEventListener('message', (event: MessageEvent<[string, Point][]>) => {
      if (settled) return;
      try {
        const positions = new Map(event.data);
        settled = true;
        clearTimeout(timer);
        resolve(positions);
        worker.terminate();
      } catch (error) {
        // Malformed data (e.g. the worker posted something that is not a
        // valid entries array) must still SETTLE the promise, or the caller
        // hangs forever with no fallback and no error anywhere.
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    worker.addEventListener('error', (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
 *
 * A worker that starts but never replies (a timeout), or replies with
 * something that cannot be turned into a `Map`, or emits an `error` event,
 * all fall back the same way — the promise always settles.
 *
 * `createWorker` is injectable only so tests can exercise the worker branch:
 * jsdom has no `Worker` at all, so without this seam nothing but Playwright
 * could ever reach `layoutInWorker`. Production call sites take one argument.
 */
export async function runLayout(
  graph: Graph,
  createWorker?: () => WorkerLike,
): Promise<Map<string, Point>> {
  if (graph.nodes.length < WORKER_THRESHOLD) {
    return layoutGraph(graph);
  }
  if (!createWorker && typeof Worker === 'undefined') {
    return layoutGraph(graph);
  }

  try {
    return await layoutInWorker(graph, createWorker);
  } catch {
    return layoutGraph(graph);
  }
}
