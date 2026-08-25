import { describe, expect, it } from 'vitest';

import { createQueue, QueueFullError } from './queue.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createQueue', () => {
  it('never runs more than maxConcurrent at once', async () => {
    const queue = createQueue({ maxConcurrent: 2 });
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => deferred());

    const runs = gates.map((gate) =>
      queue.withSlot(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );

    // Read after every single release, not just at the end: a limit that is
    // checked only on entry would still show a peak of 2 at the end while
    // having briefly run 3.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(peak).toBeLessThanOrEqual(2);
    }

    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(queue.active).toBe(0);
  });

  it('restarts the browser every restartEvery renders, and only when idle', async () => {
    const restartsAt: number[] = [];
    let done = 0;
    const queue = createQueue({
      maxConcurrent: 2,
      restartEvery: 3,
      restart: async () => {
        restartsAt.push(done);
      },
    });

    for (let i = 0; i < 6; i += 1) {
      await queue.withSlot(async () => {
        done += 1;
      });
    }

    expect(restartsAt).toEqual([3, 6]);
  });

  it('frees the slot when the render throws', async () => {
    const queue = createQueue({ maxConcurrent: 1 });

    await expect(
      queue.withSlot(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queue.active).toBe(0);
    await expect(queue.withSlot(async () => 'ok')).resolves.toBe('ok');
  });

  it('sheds past maxDepth rather than parking callers without limit', async () => {
    const queue = createQueue({ maxConcurrent: 1, maxDepth: 2 });
    const gate = deferred();

    const running = queue.withSlot(() => gate.promise);
    const parked = [queue.withSlot(async () => {}), queue.withSlot(async () => {})];

    expect(queue.pending).toBe(3);
    // The fourth caller is one past the depth and must be refused OUTRIGHT —
    // a parked caller still holds its request body, which is the whole point.
    await expect(queue.withSlot(async () => {})).rejects.toBeInstanceOf(QueueFullError);
    expect(queue.pending).toBe(3);

    gate.resolve();
    await Promise.all([running, ...parked]);
    expect(queue.pending).toBe(0);

    // Depth is a live limit, not a fuse: the queue accepts work again.
    await expect(queue.withSlot(async () => 'ok')).resolves.toBe('ok');
  });
});
