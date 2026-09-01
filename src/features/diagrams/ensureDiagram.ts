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
 * A render failure — including a syntax error — propagates and caches
 * NOTHING. Caching an error is tempting (the answer cannot change until the
 * source does, and the source is the key) and is refused deliberately: it
 * would put a second kind of record in a store whose whole contract is
 * "a hash names one SVG", and the cost of a wrong refusal is one extra
 * request, not a silently stuck cache entry.
 *
 * `DiagramError` from `requestDiagram` is the ONLY thing this function
 * throws. The IndexedDB cache itself can fail too — quota, a blocked
 * connection — and that is a plausible production failure, not a bug; a
 * caller (export's `collectDiagrams` narrowly catches `DiagramError` and
 * would otherwise let a cache failure crash the whole export over a diagram
 * the network could still render fine. So:
 *
 * - a cache READ (`repo.get`) that throws is treated as a MISS: falls
 *   through to the network render rather than failing outright.
 * - a cache WRITE (`repo.touch`, `repo.put`) that throws is IGNORED: the SVG
 *   that was already found or just rendered is still returned. Failing to
 *   remember it is not a reason to fail to show it.
 */
export async function ensureDiagram(source: string, deps: EnsureDiagramDeps = {}): Promise<string> {
  const request = deps.request ?? requestDiagram;
  const repo =
    deps.diagrams ?? (deps.now ? createDiagramsRepository({ db, now: deps.now }) : diagrams);

  const hash = await diagramKey(source);

  const cached = await readCache(repo, hash);
  if (cached) {
    // A refresh failure does not cost the caller the hit it already has.
    await repo.touch(hash).catch(() => undefined);
    return cached.svg;
  }

  const existing = inFlight.get(hash);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const svg = await request(source);
      // A write failure does not cost the caller the render it just paid for.
      await repo.put(hash, svg).catch(() => undefined);
      return svg;
    } finally {
      inFlight.delete(hash);
    }
  })();

  inFlight.set(hash, promise);
  return promise;
}

/**
 * `repo.get`, with a thrown read failure treated as a plain miss rather than
 * propagated — see the "cache READ" bullet on `ensureDiagram` above.
 */
async function readCache(
  repo: DiagramsRepository,
  hash: string,
): Promise<Awaited<ReturnType<DiagramsRepository['get']>>> {
  try {
    return await repo.get(hash);
  } catch {
    return undefined;
  }
}
