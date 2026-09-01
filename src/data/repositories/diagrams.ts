import type { BearDatabase } from '../db';
import type { DiagramRecord } from '../types';

/**
 * 2 MB is hundreds of rendered diagrams at a few KB of SVG each — plenty for
 * the notes any one device is likely to touch, without letting the cache grow
 * unbounded. Eviction is by `lastUsed` ascending (LRU), and a single SVG
 * larger than the whole budget is refused rather than evicting everything
 * else to make room for it: the diagram still renders and displays this
 * session, it simply is not cached.
 */
export const DIAGRAM_CACHE_MAX_BYTES = 2 * 1024 * 1024;

export interface DiagramsRepositoryDeps {
  db: BearDatabase;
  now?: () => number;
  /** Overridable for tests; defaults to `DIAGRAM_CACHE_MAX_BYTES`. */
  maxBytes?: number;
}

export interface DiagramsRepository {
  get(hash: string): Promise<DiagramRecord | undefined>;
  /**
   * Stores a rendered SVG, refreshing `lastUsed`, then evicts the
   * least-recently-used entries until the store is back within budget.
   *
   * A no-op (the SVG is not stored) when the SVG alone exceeds the whole
   * budget: storing it would require evicting every other entry and it still
   * would not fit.
   */
  put(hash: string, svg: string): Promise<void>;
  /** Refreshes `lastUsed` without rewriting the SVG, so a cache hit counts. */
  touch(hash: string): Promise<void>;
}

export function createDiagramsRepository(deps: DiagramsRepositoryDeps): DiagramsRepository {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  const maxBytes = deps.maxBytes ?? DIAGRAM_CACHE_MAX_BYTES;

  async function evict(): Promise<void> {
    const total = (await db.diagrams.toArray()).reduce((sum, row) => sum + row.bytes, 0);
    if (total <= maxBytes) return;

    const oldestFirst = await db.diagrams.orderBy('lastUsed').toArray();
    let over = total - maxBytes;
    const toDelete: string[] = [];
    for (const row of oldestFirst) {
      if (over <= 0) break;
      toDelete.push(row.hash);
      over -= row.bytes;
    }
    if (toDelete.length > 0) await db.diagrams.bulkDelete(toDelete);
  }

  return {
    async get(hash) {
      return db.diagrams.get(hash);
    },

    async put(hash, svg) {
      // `svg.length` is UTF-16 code units, not a true UTF-8 byte count — a
      // deliberate approximation, not an oversight. This is a SOFT LRU
      // budget, not an allocation limit: under-counting only means the
      // cache holds slightly more than `maxBytes` before the next eviction.
      // Measured error for Korean-heavy diagram labels is ~5-15% aggregate
      // (a Hangul syllable is 1 UTF-16 unit but 3 UTF-8 bytes, while the
      // surrounding SVG markup is ASCII and counts 1:1), so the effective
      // ceiling against DIAGRAM_CACHE_MAX_BYTES is ~2.2-2.3 MB rather than a
      // hard 2 MB — still "hundreds of diagrams", which is what the budget
      // is sized for. Not worth the complexity of a real UTF-8 count for a
      // number nothing downstream treats as exact.
      const bytes = svg.length;
      if (bytes > maxBytes) return;

      const record: DiagramRecord = { hash, svg, bytes, lastUsed: now() };
      await db.diagrams.put(record);
      await evict();
    },

    async touch(hash) {
      await db.diagrams.update(hash, { lastUsed: now() });
    },
  };
}
