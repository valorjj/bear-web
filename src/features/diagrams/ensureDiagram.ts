import {
  createDiagramsRepository,
  db,
  diagramKey,
  diagrams,
  type DiagramsRepository,
} from '@/data';

import { requestDiagram } from './requestDiagram';

export interface EnsureDiagramDeps {
  /** Overridable for tests; defaults to `requestDiagram`. */
  request?: (source: string) => Promise<string>;
  /**
   * Overridable for tests; defaults to the shared `diagrams` repository
   * (or, when `now` is given without this, a fresh repository over the same
   * `db` carrying that clock — see `now` below).
   */
  diagrams?: DiagramsRepository;
  /**
   * Overridable for tests. The shared `diagrams` singleton owns its own
   * clock, so threading a custom one through means building a repository
   * that wraps the same `db` with THIS clock instead — same underlying
   * IndexedDB table, deterministic `lastUsed`.
   */
  now?: () => number;
}

/**
 * In-flight requests, keyed by content hash.
 *
 * Module scope, deliberately: three copies of the same diagram in one note
 * mount three node views in the same tick, each calling `ensureDiagram`
 * independently. Without this map that is three renders of identical input
 * racing the same two-deep container queue. Every asker for the same source
 * shares one promise; the entry is deleted in a `finally` so a REJECTION
 * does not pin a failed promise in the map forever — the next ask must be
 * free to try again.
 */
const inFlight = new Map<string, Promise<string>>();

/** Test-only: clears the coalescing map between cases. Never call in app code. */
export function __resetInFlightForTests(): void {
  inFlight.clear();
}

/**
 * Cache-first diagram lookup: a hit returns the stored SVG (and refreshes
 * `lastUsed`); a miss renders through `requestDiagram`, stores the result,
 * and returns it.
 *
 * A failure — including a syntax error — propagates and caches NOTHING.
 * Caching an error is tempting (the answer cannot change until the source
 * does, and the source is the key) and is refused deliberately: it would put
 * a second kind of record in a store whose whole contract is "a hash names
 * one SVG", and the cost of a wrong refusal is one extra request, not a
 * silently stuck cache entry.
 */
export async function ensureDiagram(source: string, deps: EnsureDiagramDeps = {}): Promise<string> {
  const request = deps.request ?? requestDiagram;
  const repo =
    deps.diagrams ?? (deps.now ? createDiagramsRepository({ db, now: deps.now }) : diagrams);

  const hash = await diagramKey(source);

  const cached = await repo.get(hash);
  if (cached) {
    await repo.touch(hash);
    return cached.svg;
  }

  const existing = inFlight.get(hash);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const svg = await request(source);
      await repo.put(hash, svg);
      return svg;
    } finally {
      inFlight.delete(hash);
    }
  })();

  inFlight.set(hash, promise);
  return promise;
}
