import { closeSharedBrowser } from './render.ts';

/**
 * At most two renders at once, and a browser restart every 50.
 *
 * Chromium's memory grows across renders and the container's `mem_limit` is a
 * kill, not a warning — a bounded queue plus a periodic restart keeps the
 * process well inside it. Two rather than one because a single slot makes one
 * slow render block an unrelated user; more than two on a Mac Mini that also
 * hosts the database buys nothing.
 */
export const MAX_CONCURRENT = 2;
export const RESTART_EVERY = 50;

/**
 * Admission, which is a different thing from concurrency.
 *
 * The concurrency limit alone bounds how many renders run; it does NOT bound
 * how many callers are parked waiting, each holding its request body against
 * the container's 1g `mem_limit`, which is a kill and not a warning.
 *
 * Over HTTP this is now the second of two limits — `MAX_INFLIGHT` in
 * `server.ts` refuses a request before its body is read, so the unbounded-
 * parking OOM is not reachable through `/render`. This one bounds any OTHER
 * caller of `withSlot`, and keeps the queue's own invariant local to the
 * queue rather than resting on a constant in a different module. Past this
 * depth callers are shed immediately, which the spec's error table already
 * maps to 503 "PDF export is unavailable right now".
 */
export const MAX_QUEUE_DEPTH = 8;

export class QueueFullError extends Error {
  constructor() {
    super('render queue is full');
    this.name = 'QueueFullError';
  }
}

export interface QueueOptions {
  maxConcurrent?: number;
  maxDepth?: number;
  restartEvery?: number;
  /** Injected so a test can observe the restart without launching Chromium. */
  restart?: () => Promise<void>;
}

export interface Queue {
  withSlot<T>(run: () => Promise<T>): Promise<T>;
  readonly active: number;
  /** Running plus parked — what admission is judged on. */
  readonly pending: number;
}

export function createQueue(options: QueueOptions = {}): Queue {
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
  const maxDepth = options.maxDepth ?? MAX_QUEUE_DEPTH;
  const restartEvery = options.restartEvery ?? RESTART_EVERY;
  const restart = options.restart ?? closeSharedBrowser;

  let active = 0;
  let sinceRestart = 0;
  const waiting: (() => void)[] = [];

  /*
   * `active` is incremented by whoever GRANTS the slot, never by the waiter
   * that receives it, so the count never dips between a release and the woken
   * waiter resuming.
   *
   * Honesty about why: the alternative — decrement on release, let the woken
   * waiter increment itself — was fault-injected and the concurrency test
   * still passed. Its window is microtask-only, and an HTTP request arrives on
   * a macrotask, so it is not reachable from this server. The hand-over form
   * is kept because it makes the invariant hold by construction rather than by
   * an argument about the event loop, NOT because a test proves the other form
   * broken. It does not.
   */
  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= maxDepth) return Promise.reject(new QueueFullError());
    return new Promise<void>((resolve) => waiting.push(resolve));
  }

  async function release(): Promise<void> {
    sinceRestart += 1;

    // `active === 1` is this caller's own slot: nothing else is in flight, so
    // tearing the browser down cannot pull it out from under a live render.
    if (sinceRestart >= restartEvery && active === 1) {
      sinceRestart = 0;
      await restart();
    }

    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  return {
    async withSlot<T>(run: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await run();
      } finally {
        await release();
      }
    },
    get active() {
      return active;
    },
    get pending() {
      return active + waiting.length;
    },
  };
}

const defaultQueue = createQueue();

export const withSlot: Queue['withSlot'] = (run) => defaultQueue.withSlot(run);
