import type { Query } from '../app.ts';

/**
 * How much image data one account may store, in bytes.
 *
 * **Its own budget, deliberately separate from `QUOTA_BYTES`.** That one is
 * 10 MiB and governs note TEXT; summing pixels into a text budget would let a
 * single screenshot exhaust it two hundred times over. The Mac Mini this runs
 * on has ~188 GB free, so 2 GiB is a guard against runaway accident rather
 * than a scarcity limit.
 */
export const IMAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

export class ImageQuotaExceededError extends Error {
  // Declared and assigned rather than a constructor parameter property:
  // `erasableSyntaxOnly` forbids those (CLAUDE.md).
  readonly used: number;
  readonly limit: number;

  constructor(used: number, limit: number) {
    super(`image quota exceeded: ${used} > ${limit}`);
    this.name = 'ImageQuotaExceededError';
    this.used = used;
    this.limit = limit;
  }
}

export interface ImageRow {
  id: string;
  noteId: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

interface ImageRecord {
  id: string;
  note_id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  created_at: number | string;
}

/** One image's metadata, or `null` — including when it belongs to someone else. */
export async function getImage(query: Query, userId: string, id: string): Promise<ImageRow | null> {
  const rows = (await query(
    'SELECT id, note_id, mime, width, height, bytes, created_at FROM image_files WHERE user_id = ? AND id = ?',
    [userId, id],
  )) as ImageRecord[];

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    noteId: row.note_id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    createdAt: Number(row.created_at),
  };
}

/**
 * Records an image's metadata.
 *
 * `INSERT IGNORE`, not a plain insert: an id names ONE immutable image, and a
 * client retrying after a dropped connection is the ordinary case rather than
 * a conflict to report. The route treats a repeat as a success and the first
 * bytes win.
 */
export async function insertImage(query: Query, userId: string, row: ImageRow): Promise<void> {
  await query(
    'INSERT IGNORE INTO image_files (user_id, id, note_id, mime, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, row.id, row.noteId, row.mime, row.width, row.height, row.bytes, row.createdAt],
  );
}

/**
 * How many bytes of image data this account is using.
 *
 * `?? 0` is load-bearing: `SUM` over no rows returns SQL `NULL`, not zero, so
 * without it the very first upload of every account compares `null` against
 * the quota and behaves unpredictably rather than obviously.
 */
export async function usedImageBytes(query: Query, userId: string): Promise<number> {
  const rows = (await query('SELECT SUM(bytes) AS total FROM image_files WHERE user_id = ?', [
    userId,
  ])) as { total: number | string | null }[];

  return Number(rows[0]?.total ?? 0);
}
