import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, diagramKey, diagrams, type DiagramsRepository } from '@/data';

import { DiagramError } from './requestDiagram';
import { __resetInFlightForTests, ensureDiagram } from './ensureDiagram';

// The `diagrams` repository here is the shared singleton (imported through
// the barrel, as `src/features/` must). Its state is cleared per test so
// cases stay isolated — the same pattern `useNotes.test.tsx` uses for `db`
// — and the module-scope in-flight coalescing map is reset too, since a
// resolved promise left in it would otherwise leak into the next case.
beforeEach(async () => {
  await db.open();
  await db.diagrams.clear();
  __resetInFlightForTests();
});

describe('ensureDiagram', () => {
  it('renders on a miss and caches the result', async () => {
    const request = vi.fn(async () => '<svg id="rendered"/>');
    const svg = await ensureDiagram('flowchart TD\n A --> B', { request });

    expect(svg).toBe('<svg id="rendered"/>');
    expect(await diagrams.get(await diagramKey('flowchart TD\n A --> B'))).toBeDefined();
  });

  it('does not ask the server twice for the same source', async () => {
    const request = vi.fn(async () => '<svg/>');
    await ensureDiagram('flowchart TD\n A --> B', { request });
    await ensureDiagram('flowchart TD\n A --> B', { request });

    // The whole point of the feature. A count, not a spy assertion on
    // "was called" — the second call is the regression this catches.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('touches lastUsed on a hit', async () => {
    const request = vi.fn(async () => '<svg/>');
    await ensureDiagram('A', { request, now: () => 1000 });
    await ensureDiagram('A', { request, now: () => 9000 });

    expect((await diagrams.get(await diagramKey('A')))?.lastUsed).toBe(9000);
  });

  it('coalesces concurrent requests for the same source', async () => {
    // Three copies of one diagram in a note mount three node views in the
    // same tick. Without coalescing that is three renders of identical
    // input, and the container queue is two deep.
    //
    // `diagramKey` awaits a real `crypto.subtle.digest` before either call
    // can reach `request`, so resolving synchronously right after kicking
    // both calls off (as a naive version of this test would) races a still
    //-unset `resolve` closure and hangs forever. Waiting for `request` to
    // have actually been invoked removes the race while still proving the
    // same thing: both askers get the one answer, and the server saw one call.
    let resolve: (svg: string) => void = () => {};
    const request = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const all = Promise.all([ensureDiagram('A', { request }), ensureDiagram('A', { request })]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    resolve('<svg/>');

    expect(await all).toEqual(['<svg/>', '<svg/>']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propagates the failure and caches nothing', async () => {
    const request = vi.fn(async () => {
      throw new DiagramError('offline');
    });

    await expect(ensureDiagram('A', { request })).rejects.toMatchObject({ reason: 'offline' });
    expect(await diagrams.get(await diagramKey('A'))).toBeUndefined();
  });

  it('does not cache a syntax error either', async () => {
    // Tempting — the answer will not change until the source does, and the
    // source is the key. Refused anyway: a cache entry holding an error is
    // a second kind of record in a store whose whole contract is "a hash
    // names one SVG", and the retry costs one request.
    const request = vi.fn(async () => {
      throw new DiagramError('invalidSyntax', 'Parse error');
    });

    await expect(ensureDiagram('A', { request })).rejects.toMatchObject({
      reason: 'invalidSyntax',
    });
    expect(await diagrams.get(await diagramKey('A'))).toBeUndefined();
  });

  it('retries after a failure instead of staying pinned to the rejection', async () => {
    // The in-flight entry must be deleted on the FAILURE path too, not only
    // on success. Without that, a diagram that failed once because the user
    // was briefly offline would return the same stale rejection forever —
    // every later ask for the same source would never reach the network
    // again for the life of the page.
    const request = vi
      .fn<(source: string) => Promise<string>>()
      .mockRejectedValueOnce(new DiagramError('offline'))
      .mockResolvedValueOnce('<svg/>');

    await expect(ensureDiagram('A', { request })).rejects.toMatchObject({ reason: 'offline' });

    const svg = await ensureDiagram('A', { request });

    expect(svg).toBe('<svg/>');
    expect(request).toHaveBeenCalledTimes(2);
    expect((await diagrams.get(await diagramKey('A')))?.svg).toBe('<svg/>');
  });
});

describe('ensureDiagram — a broken cache degrades rather than fails the caller', () => {
  // A cache failure (quota, a blocked connection) is a plausible production
  // event, not a bug -- unlike a `DiagramError` from the network, it says
  // nothing about whether the diagram itself is renderable. `collectDiagrams`
  // in export narrowly catches only `DiagramError`, so `ensureDiagram` must
  // never let a cache failure escape as anything else, or a note with a
  // healthy diagram and a broken IndexedDB would fail to export at all.

  it('treats a throwing cache read as a miss: still renders and resolves to the SVG', async () => {
    const request = vi.fn(async () => '<svg id="rendered"/>');
    const brokenGet: DiagramsRepository = {
      get: vi.fn(async () => {
        throw new Error('IDB blocked');
      }),
      put: vi.fn(async () => undefined),
      touch: vi.fn(async () => undefined),
    };

    const svg = await ensureDiagram('A', { request, diagrams: brokenGet });

    expect(svg).toBe('<svg id="rendered"/>');
    // Falls through to the network -- a read failure must not be mistaken
    // for "already cached, nothing to do".
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ignores a throwing cache write and still resolves to the freshly rendered SVG', async () => {
    const request = vi.fn(async () => '<svg id="rendered"/>');
    const brokenPut: DiagramsRepository = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        throw new Error('IDB quota exceeded');
      }),
      touch: vi.fn(async () => undefined),
    };

    const svg = await ensureDiagram('A', { request, diagrams: brokenPut });

    // Failing to remember the render is not a reason to fail to show it.
    expect(svg).toBe('<svg id="rendered"/>');
  });

  it('ignores a throwing cache touch on a HIT and still resolves to the cached SVG', async () => {
    // The third leg of the triad: `get` above, `put` above, `touch` here — a
    // refresh failure on an already-successful hit must not cost the caller
    // the hit it already has.
    const request = vi.fn(async () => '<svg id="should-not-be-requested"/>');
    const brokenTouch: DiagramsRepository = {
      get: vi.fn(async () => ({
        hash: await diagramKey('A'),
        svg: '<svg id="cached"/>',
        bytes: 20,
        lastUsed: 1,
      })),
      put: vi.fn(async () => undefined),
      touch: vi.fn(async () => {
        throw new Error('IDB blocked');
      }),
    };

    const svg = await ensureDiagram('A', { request, diagrams: brokenTouch });

    expect(svg).toBe('<svg id="cached"/>');
    // A hit never asks the network, broken touch or not.
    expect(request).not.toHaveBeenCalled();
  });
});
