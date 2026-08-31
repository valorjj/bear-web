import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGraph } from './buildGraph';
import { layoutGraph } from './layoutGraph';
import { runLayout, WORKER_THRESHOLD, WORKER_TIMEOUT_MS, type WorkerLike } from './runLayout';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

/** A minimal stand-in for `Worker`, since jsdom has none at all. */
class FakeWorker implements WorkerLike {
  private messageListener?: (event: MessageEvent) => void;
  private errorListener?: (event: ErrorEvent) => void;
  private readonly onPostMessage: (worker: FakeWorker) => void;
  terminated = false;

  constructor(onPostMessage: (worker: FakeWorker) => void) {
    this.onPostMessage = onPostMessage;
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') this.messageListener = listener as (event: MessageEvent) => void;
    else this.errorListener = listener as (event: ErrorEvent) => void;
  }

  postMessage(): void {
    // Real `Worker` delivery is asynchronous — `message`/`error` fire after
    // the caller's call stack (including the `new Promise(...)` executor)
    // has returned. `queueMicrotask` reproduces that, which matters: a
    // synchronous delivery would let a throw inside the listener be caught
    // by the Promise constructor's own implicit try/catch instead of by
    // `layoutInWorker`'s handler, making a broken handler indistinguishable
    // from a fixed one.
    queueMicrotask(() => this.onPostMessage(this));
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.messageListener?.({ data } as MessageEvent);
  }

  emitError(message: string): void {
    this.errorListener?.({ message } as ErrorEvent);
  }
}

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

  describe('with an injected worker factory', () => {
    const bigIndex = Array.from({ length: WORKER_THRESHOLD + 5 }, (_, i) =>
      note(`n${String(i).padStart(4, '0')}`, `N${i}`),
    );
    const bigGraph = buildGraph(bigIndex, []);

    it('calls the injected factory above WORKER_THRESHOLD', async () => {
      const expected = [...layoutGraph(bigGraph)];
      const createWorker = vi.fn(
        (): WorkerLike => new FakeWorker((worker) => worker.emitMessage(expected)),
      );

      const positions = await runLayout(bigGraph, createWorker);

      expect(createWorker).toHaveBeenCalledTimes(1);
      expect([...positions]).toEqual(expected);
    });

    it('falls back and returns a correct layout when the worker posts malformed data', async () => {
      const createWorker = (): WorkerLike =>
        new FakeWorker((worker) => worker.emitMessage('garbage'));

      const positions = await runLayout(bigGraph, createWorker);

      expect([...positions]).toEqual([...layoutGraph(bigGraph)]);
    });

    it('falls back and returns a correct layout when the worker emits an error event', async () => {
      const createWorker = (): WorkerLike => new FakeWorker((worker) => worker.emitError('boom'));

      const positions = await runLayout(bigGraph, createWorker);

      expect([...positions]).toEqual([...layoutGraph(bigGraph)]);
    });

    describe('the timeout', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('falls back and terminates the worker when it never replies', async () => {
        let created: FakeWorker | undefined;
        const createWorker = (): WorkerLike => {
          created = new FakeWorker(() => {
            // Never responds — simulates a worker that started but hung.
          });
          return created;
        };

        const result = runLayout(bigGraph, createWorker);
        await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
        const positions = await result;

        expect(created?.terminated).toBe(true);
        expect([...positions]).toEqual([...layoutGraph(bigGraph)]);
      });
    });
  });
});
