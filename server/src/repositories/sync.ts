import type { Query, Transaction } from '../app.ts';
import { nextRev } from './revisions.ts';

/** 10 MiB of note text per user. The bound on disk growth under open signup. */
export const QUOTA_BYTES = 10 * 1024 * 1024;

/** Ninety days, per the spec. A device offline longer than this may resurrect a note. */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface SyncNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
  deleted: boolean;
  rev: number;
}

export interface SyncTag {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
  deleted: boolean;
  rev: number;
}

export interface PushNote extends Omit<SyncNote, 'rev'> {
  /** The `rev` this device last saw for this note. 0 means "never synced". */
  baseRev: number;
}

export interface PushTag extends Omit<SyncTag, 'rev'> {
  baseRev: number;
}

export interface PullResult {
  notes: SyncNote[];
  tags: SyncTag[];
  rev: number;
}

export interface PushResult {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: SyncNote[]; tags: SyncTag[] };
  rev: number;
}

export class QuotaExceededError extends Error {
  readonly used: number;
  readonly limit: number;

  constructor(used: number, limit: number) {
    super(`quota exceeded: ${used} > ${limit}`);
    this.used = used;
    this.limit = limit;
  }
}

interface NoteRow {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  trashed_at: number | null;
  archived_at: number | null;
  deleted: number;
  rev: number;
}

interface TagRow {
  tag: string;
  collapsed: number;
  icon_key: string | null;
  sort_order: number;
  deleted: number;
  rev: number;
}

function toNote(row: NoteRow): SyncNote {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // MySQL hands TINYINT back as a number; the wire format is a real boolean
    // so the client never has to know which.
    pinned: row.pinned === 1,
    trashedAt: row.trashed_at,
    archivedAt: row.archived_at,
    deleted: row.deleted === 1,
    rev: row.rev,
  };
}

function toTag(row: TagRow): SyncTag {
  return {
    tag: row.tag,
    collapsed: row.collapsed === 1,
    iconKey: row.icon_key,
    sortOrder: row.sort_order,
    deleted: row.deleted === 1,
    rev: row.rev,
  };
}

/** UTF-8 bytes, not characters: a character count lets three-byte scripts store 3x the cap. */
function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export async function pull(query: Query, userId: string, since: number): Promise<PullResult> {
  const noteRows = (await query(
    `SELECT id, text, created_at, updated_at, pinned, trashed_at, archived_at, deleted, rev
       FROM notes WHERE user_id = ? AND rev > ? ORDER BY rev ASC`,
    [userId, since],
  )) as NoteRow[];

  const tagRows = (await query(
    `SELECT tag, collapsed, icon_key, sort_order, deleted, rev
       FROM tag_meta WHERE user_id = ? AND rev > ? ORDER BY rev ASC`,
    [userId, since],
  )) as TagRow[];

  const counter = (await query('SELECT rev_counter FROM users WHERE id = ?', [userId])) as Array<{
    rev_counter: number;
  }>;

  return {
    notes: noteRows.map(toNote),
    tags: tagRows.map(toTag),
    // The user's current counter, NOT the highest rev returned: a pull that
    // finds nothing must still advance the client's cursor, or every
    // subsequent pull re-scans the same range forever.
    rev: counter[0]?.rev_counter ?? since,
  };
}

/**
 * Applies a batch atomically.
 *
 * One revision is allocated for the whole batch and stamped on every row it
 * writes. Per-row revisions would be equally correct and eight times the
 * counter contention, for a pull granularity nobody can observe.
 *
 * Conflicts do NOT abort the batch: a stale note is skipped and returned, its
 * siblings are still written. A quota overrun DOES abort it — the transaction
 * rolls back, so a refused push leaves the account exactly as it was.
 */
export async function push(
  transaction: Transaction,
  userId: string,
  input: { notes: PushNote[]; tags: PushTag[] },
): Promise<PushResult> {
  return transaction(async (query) => {
    const accepted: PushResult['accepted'] = [];
    const conflicts: PushResult['conflicts'] = { notes: [], tags: [] };

    const existingNotes = new Map(
      (
        (await query(
          `SELECT id, text, created_at, updated_at, pinned, trashed_at, archived_at, deleted, rev
             FROM notes WHERE user_id = ?`,
          [userId],
        )) as NoteRow[]
      ).map((row) => [row.id, row]),
    );

    const existingTags = new Map(
      (
        (await query(
          `SELECT tag, collapsed, icon_key, sort_order, deleted, rev
             FROM tag_meta WHERE user_id = ?`,
          [userId],
        )) as TagRow[]
      ).map((row) => [row.tag, row]),
    );

    const writableNotes = input.notes.filter((incoming) => {
      const current = existingNotes.get(incoming.id);
      if (current !== undefined && current.rev > incoming.baseRev) {
        conflicts.notes.push(toNote(current));
        return false;
      }
      return true;
    });

    const writableTags = input.tags.filter((incoming) => {
      const current = existingTags.get(incoming.tag);
      if (current !== undefined && current.rev > incoming.baseRev) {
        conflicts.tags.push(toTag(current));
        return false;
      }
      return true;
    });

    // Quota is checked against what the account WOULD hold, before anything is
    // written: the total of every note this batch does not touch, plus every
    // note it does. Checking afterwards would mean rolling back a write that
    // has already grown the tablespace.
    const untouched = [...existingNotes.values()]
      .filter((row) => !writableNotes.some((note) => note.id === row.id))
      .filter((row) => row.deleted === 0)
      .reduce((total, row) => total + byteSize(row.text), 0);

    const incoming = writableNotes
      .filter((note) => !note.deleted)
      .reduce((total, note) => total + byteSize(note.text), 0);

    if (untouched + incoming > QUOTA_BYTES) {
      throw new QuotaExceededError(untouched + incoming, QUOTA_BYTES);
    }

    if (writableNotes.length === 0 && writableTags.length === 0) {
      const counter = (await query('SELECT rev_counter FROM users WHERE id = ?', [
        userId,
      ])) as Array<{ rev_counter: number }>;
      return { accepted, conflicts, rev: counter[0]?.rev_counter ?? 0 };
    }

    const rev = await nextRev(query, userId);

    for (const note of writableNotes) {
      // A tombstone keeps no text. Retaining the body of a purged note would
      // mean a delete that frees nothing and leaks what the user deleted.
      const text = note.deleted ? '' : note.text;

      await query(
        `INSERT INTO notes (user_id, id, rev, text, created_at, updated_at, pinned, trashed_at,
            archived_at, deleted, deleted_at, byte_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rev = VALUES(rev), text = VALUES(text), updated_at = VALUES(updated_at),
           pinned = VALUES(pinned), trashed_at = VALUES(trashed_at),
           archived_at = VALUES(archived_at), deleted = VALUES(deleted),
           deleted_at = VALUES(deleted_at), byte_size = VALUES(byte_size)`,
        [
          userId,
          note.id,
          rev,
          text,
          note.createdAt,
          note.updatedAt,
          note.pinned ? 1 : 0,
          note.trashedAt,
          note.archivedAt,
          note.deleted ? 1 : 0,
          note.deleted ? note.updatedAt : null,
          byteSize(text),
        ],
      );

      accepted.push({ id: note.id, kind: 'note' });
    }

    for (const tag of writableTags) {
      await query(
        `INSERT INTO tag_meta (user_id, tag, rev, collapsed, icon_key, sort_order, deleted, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rev = VALUES(rev), collapsed = VALUES(collapsed), icon_key = VALUES(icon_key),
           sort_order = VALUES(sort_order), deleted = VALUES(deleted),
           deleted_at = VALUES(deleted_at)`,
        [
          userId,
          tag.tag,
          rev,
          tag.collapsed ? 1 : 0,
          tag.iconKey,
          tag.sortOrder,
          tag.deleted ? 1 : 0,
          tag.deleted ? Date.now() : null,
        ],
      );

      accepted.push({ id: tag.tag, kind: 'tag' });
    }

    return { accepted, conflicts, rev };
  });
}

/**
 * Removes this user's tombstones older than the retention period.
 *
 * Opportunistic, called from `GET /sync`: a scheduled job would be a second
 * thing that must stay running on a machine where the API server itself has
 * already died from exactly that.
 *
 * Counted first, then deleted. `createPool`'s `query` normalises anything that
 * is not a row set to `[]`, so a DELETE reports no `affectedRows` through it —
 * and widening `Query` to expose them would change the one shape every
 * repository and the tenancy guard are both written against.
 */
export async function sweepTombstones(query: Query, userId: string, now: number): Promise<number> {
  const cutoff = now - TOMBSTONE_RETENTION_MS;

  const doomedNotes = (await query(
    'SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND deleted = 1 AND deleted_at < ?',
    [userId, cutoff],
  )) as Array<{ n: number }>;

  const doomedTags = (await query(
    'SELECT COUNT(*) AS n FROM tag_meta WHERE user_id = ? AND deleted = 1 AND deleted_at < ?',
    [userId, cutoff],
  )) as Array<{ n: number }>;

  await query('DELETE FROM notes WHERE user_id = ? AND deleted = 1 AND deleted_at < ?', [
    userId,
    cutoff,
  ]);
  await query('DELETE FROM tag_meta WHERE user_id = ? AND deleted = 1 AND deleted_at < ?', [
    userId,
    cutoff,
  ]);

  return Number(doomedNotes[0]?.n ?? 0) + Number(doomedTags[0]?.n ?? 0);
}
