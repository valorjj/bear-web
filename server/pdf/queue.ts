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

export interface QueueOptions {
  maxConcurrent?: number;
  restartEvery?: number;
  /** Injected so a test can observe the restart without launching Chromium. */
  restart?: () => Promise<void>;
}

export interface Queue {
  withSlot<T>(run: () => Promise<T>): Promise<T>;
  readonly active: number;
}

export function createQueue(options: QueueOptions = {}): Queue {
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
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
  };
}

const defaultQueue = createQueue();

export const withSlot: Queue['withSlot'] = (run) => defaultQueue.withSlot(run);
