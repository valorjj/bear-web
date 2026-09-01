import type { Query } from '../app.ts';

/**
 * How much published-HTML data one account may serve publicly, at once.
 *
 * Its own budget, deliberately separate from `IMAGE_QUOTA_BYTES` and
 * `QUOTA_BYTES`: a published page is rendered HTML that a stranger can fetch
 * with no session at all, so it gets its own, smaller ceiling rather than
 * borrowing headroom meant for private storage.
 */
export const PUBLISH_QUOTA_BYTES = 100 * 1024 * 1024;

/**
 * How many pages one account may have published at once.
 *
 * A byte ceiling alone does not stop someone from publishing thousands of
 * tiny pages; this bounds the row count (and therefore the public surface
 * area) independently of size.
 */
export const MAX_PUBLISHED_PAGES = 50;

export interface PublishedPage {
  id: string;
  noteId: string;
  title: string;
  bytes: number;
  publishedAt: number;
}

interface PublishedPageRecord {
  id: string;
  note_id: string;
  title: string;
  bytes: number;
  published_at: number | string;
}

function toPublishedPage(row: PublishedPageRecord): PublishedPage {
  return {
    id: row.id,
    noteId: row.note_id,
    title: row.title,
    bytes: row.bytes,
    publishedAt: Number(row.published_at),
  };
}

/** A note's published page, or `null` — including when it belongs to someone else. */
export async function getPageForNote(
  query: Query,
  userId: string,
  noteId: string,
): Promise<PublishedPage | null> {
  const rows = (await query(
    'SELECT id, note_id, title, bytes, published_at FROM published_pages WHERE user_id = ? AND note_id = ?',
    [userId, noteId],
  )) as PublishedPageRecord[];

  const row = rows[0];
  return row === undefined ? null : toPublishedPage(row);
}

/**
 * Which account owns a published page, by its capability id alone.
 *
 * The ONE query in this repository that does not scope by `user_id`, and the
 * reason is the design: a public reader has no session, so the unguessable id
 * IS the authorization. The id is 128 bits from a CSPRNG; guessing one is the
 * attack this design accepts, and rate limiting is what bounds it.
 */
export async function getPageOwner(query: Query, id: string): Promise<{ userId: string } | null> {
  /* tenancy-ok: the capability id IS the authorization; a public reader has no session */
  const rows = (await query('SELECT user_id FROM published_pages WHERE id = ?', [id])) as {
    user_id: string;
  }[];

  const row = rows[0];
  return row === undefined ? null : { userId: row.user_id };
}

/** Every page an account has published, for its own management UI. */
export async function listPages(query: Query, userId: string): Promise<PublishedPage[]> {
  const rows = (await query(
    'SELECT id, note_id, title, bytes, published_at FROM published_pages WHERE user_id = ?',
    [userId],
  )) as PublishedPageRecord[];

  return rows.map(toPublishedPage);
}

/**
 * Publishes or republishes a note.
 *
 * `INSERT … ON DUPLICATE KEY UPDATE` against `uniq_published_user_note`: one
 * note publishes to ONE url, so a republish (the author fixing a typo) keeps
 * the same `id` and therefore the same shareable link, while `title`,
 * `bytes` and `published_at` are refreshed to the new snapshot.
 */
export async function upsertPage(query: Query, userId: string, page: PublishedPage): Promise<void> {
  await query(
    `INSERT INTO published_pages (id, user_id, note_id, title, bytes, published_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), bytes = VALUES(bytes), published_at = VALUES(published_at)`,
    [page.id, userId, page.noteId, page.title, page.bytes, page.publishedAt],
  );
}

/** Unpublishes a page. A no-op if `id` does not belong to `userId`. */
export async function deletePage(query: Query, userId: string, id: string): Promise<void> {
  await query('DELETE FROM published_pages WHERE user_id = ? AND id = ?', [userId, id]);
}

/**
 * How many bytes of published HTML this account is currently serving.
 *
 * `?? 0` is load-bearing: `SUM` over no rows returns SQL `NULL`, not zero, so
 * without it the very first publish of every account compares `null` against
 * the quota and behaves unpredictably rather than obviously.
 */
export async function usedPublishBytes(query: Query, userId: string): Promise<number> {
  const rows = (await query('SELECT SUM(bytes) AS total FROM published_pages WHERE user_id = ?', [
    userId,
  ])) as { total: number | string | null }[];

  return Number(rows[0]?.total ?? 0);
}

/** How many pages this account currently has published, for `MAX_PUBLISHED_PAGES`. */
export async function countPages(query: Query, userId: string): Promise<number> {
  const rows = (await query('SELECT COUNT(*) AS total FROM published_pages WHERE user_id = ?', [
    userId,
  ])) as { total: number | string }[];

  return Number(rows[0]?.total ?? 0);
}
