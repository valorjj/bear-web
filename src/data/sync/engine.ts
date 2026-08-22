import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { newId } from '../ids';
import { reindexNote } from '../reindex';
import type { Note, TagMeta } from '../types';
import type { PushNote, PushTag, RemoteNote, RemoteTag, Transport } from './transport';

/** The highest revision this device has applied. Reset when the account changes. */
export const LAST_PULLED_REV_KEY = 'sync:lastPulledRev';

/**
 * Which account the cursor above belongs to.
 *
 * Revision counters are per user. Reusing one account's cursor for another
 * means pulling `rev > 99` from a counter sitting at 3: nothing comes back,
 * nothing is wrong, and the second account's notes never appear.
 */
export const SYNCED_ACCOUNT_KEY = 'sync:accountId';

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  conflicts: number;
  rev: number;
}

export interface EngineDeps {
  db: BearDatabase;
  transport: Transport;
  parseTags: (markdown: string) => string[];
  now?: () => number;
  generateId?: () => string;
}

function toNote(remote: RemoteNote): Note {
  return {
    id: remote.id,
    // The server stores no title. `deriveTitle` is its only author, here as
    // everywhere else.
    title: deriveTitle(remote.text),
    text: remote.text,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    pinned: remote.pinned,
    trashedAt: remote.trashedAt,
    archivedAt: remote.archivedAt,
  };
}

/**
 * The local text, with ` (conflict)` appended to its FIRST non-empty line.
 *
 * The marker has to live in the TEXT, not on the row's `title`. `title` is a
 * derived cache whose single author is `deriveTitle`, so a hand-assigned title
 * survives only until something re-derives it — `notes.save` does that on the
 * user's very next edit of the copy, on this same device, and `toNote` does it
 * again the moment the copy is pulled onto a second one. Either way the marker
 * evaporates and the user is left with two identically-titled notes and no way
 * to tell the losing edit from the winning one, which is precisely the outcome
 * the conflict copy exists to prevent.
 *
 * Every other line is left untouched: this is the user's losing edit, and the
 * copy is only useful if it is that edit verbatim.
 *
 * Text with no non-empty line at all gets the marker as a new FIRST line
 * rather than replacing anything, so a blank note's copy still has a title a
 * user can see in the list, and whatever whitespace was there is preserved.
 */
export function markConflictText(text: string): string {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.trim() !== '');

  if (index === -1) return text === '' ? '(conflict)' : `(conflict)\n${text}`;

  lines[index] = `${lines[index]!.replace(/\s+$/, '')} (conflict)`;
  return lines.join('\n');
}

function toTagMeta(remote: RemoteTag): TagMeta {
  return {
    tag: remote.tag,
    collapsed: remote.collapsed,
    iconKey: remote.iconKey,
    sortOrder: remote.sortOrder,
  };
}

export function createEngine(deps: EngineDeps) {
  const { db, transport, parseTags } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /**
   * Replaces a note's derived tag rows.
   *
   * Deliberately the SHARED `reindexNote` that `repositories/notes.ts` calls,
   * not a private copy: the tag index has already disagreed with its own
   * rebuild once in this project's history, and a second implementation of
   * "how tags are derived from text" is exactly how that regresses.
   */
  async function reindex(noteId: string, text: string): Promise<void> {
    await reindexNote(db, noteId, text, parseTags);
  }

  async function readCursor(accountId: string): Promise<number> {
    const account = await db.settings.get(SYNCED_ACCOUNT_KEY);
    if (account?.value !== accountId) {
      await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: accountId });
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 0 });
      return 0;
    }
    const cursor = await db.settings.get(LAST_PULLED_REV_KEY);
    return typeof cursor?.value === 'number' ? cursor.value : 0;
  }

  /**
   * Writes pulled rows locally.
   *
   * A locally dirty note is left alone: it is being pushed in this same run,
   * and the server — not this function — decides which side wins. Applying the
   * remote copy here would destroy the local edit before the conflict rule
   * ever ran, which is the one outcome the whole `(conflict)` design exists
   * to prevent.
   */
  async function applyNotes(remotes: RemoteNote[]): Promise<number> {
    let applied = 0;

    for (const remote of remotes) {
      const state = await db.syncState.get(['note', remote.id]);
      if (state?.dirty === 1) continue;

      if (remote.deleted) {
        await db.transaction(
          'rw',
          db.notes,
          db.noteTags,
          db.files,
          db.noteFolds,
          db.syncState,
          async () => {
            await db.noteTags.where('noteId').equals(remote.id).delete();
            await db.files.where('noteId').equals(remote.id).delete();
            await db.noteFolds.delete(remote.id);
            await db.notes.delete(remote.id);
            await db.syncState.delete(['note', remote.id]);
          },
        );
      } else {
        await db.transaction('rw', db.notes, db.noteTags, db.syncState, async () => {
          await db.notes.put(toNote(remote));
          await reindex(remote.id, remote.text);
          await db.syncState.put({
            kind: 'note',
            key: remote.id,
            syncedRev: remote.rev,
            dirty: 0,
            deleted: 0,
            markedAt: remote.updatedAt,
          });
        });
      }

      applied += 1;
    }

    return applied;
  }

  async function applyTags(remotes: RemoteTag[]): Promise<number> {
    let applied = 0;

    for (const remote of remotes) {
      const state = await db.syncState.get(['tag', remote.tag]);
      if (state?.dirty === 1) continue;

      await db.transaction('rw', db.tags, db.syncState, async () => {
        if (remote.deleted) {
          await db.tags.delete(remote.tag);
          await db.syncState.delete(['tag', remote.tag]);
        } else {
          await db.tags.put(toTagMeta(remote));
          await db.syncState.put({
            kind: 'tag',
            key: remote.tag,
            syncedRev: remote.rev,
            dirty: 0,
            deleted: 0,
            markedAt: now(),
          });
        }
      });

      applied += 1;
    }

    return applied;
  }

  /** Collects everything dirty, with the revision each row last saw as its `baseRev`. */
  async function collect(): Promise<{
    notes: PushNote[];
    tags: PushTag[];
    snapshots: Map<string, number>;
  }> {
    const dirty = await db.syncState.where('dirty').equals(1).toArray();
    const notes: PushNote[] = [];
    const tags: PushTag[] = [];
    // `markedAt` at the moment of collection, per note id. Compared against the
    // stored note on accept, so an edit landing mid-flight cannot be cleared.
    const snapshots = new Map<string, number>();

    for (const row of dirty) {
      if (row.kind === 'note') {
        snapshots.set(row.key, row.markedAt);

        if (row.deleted === 1) {
          notes.push({
            id: row.key,
            text: '',
            createdAt: 0,
            updatedAt: row.markedAt,
            pinned: false,
            trashedAt: null,
            archivedAt: null,
            deleted: true,
            baseRev: row.syncedRev,
          });
          continue;
        }

        const note = await db.notes.get(row.key);
        // The row and its note disagree: the note is gone but nothing recorded
        // a purge. Drop the bookkeeping rather than pushing an empty note.
        if (note === undefined) {
          await db.syncState.delete(['note', row.key]);
          continue;
        }

        notes.push({
          id: note.id,
          text: note.text,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          pinned: note.pinned,
          trashedAt: note.trashedAt,
          archivedAt: note.archivedAt,
          deleted: false,
          baseRev: row.syncedRev,
        });
      } else {
        if (row.deleted === 1) {
          tags.push({
            tag: row.key,
            collapsed: false,
            iconKey: null,
            sortOrder: 0,
            deleted: true,
            baseRev: row.syncedRev,
          });
          continue;
        }

        const meta = await db.tags.get(row.key);
        if (meta === undefined) {
          await db.syncState.delete(['tag', row.key]);
          continue;
        }

        tags.push({
          tag: meta.tag,
          collapsed: meta.collapsed,
          iconKey: meta.iconKey,
          sortOrder: meta.sortOrder,
          deleted: false,
          baseRev: row.syncedRev,
        });
      }
    }

    return { notes, tags, snapshots };
  }

  /**
   * Takes the server's copy and keeps the local text as a visible note.
   *
   * No dialog, no merge UI, no silent loss: the losing edit is always a real
   * note the user can open, compare and delete. This is last-write-wins
   * without last-write-wins's data loss.
   */
  async function resolveConflicts(remotes: RemoteNote[]): Promise<void> {
    for (const remote of remotes) {
      await db.transaction('rw', db.notes, db.noteTags, db.syncState, async () => {
        // Read INSIDE the transaction that then writes from it: this decides
        // whether a copy is needed and is immediately followed by the write
        // that overwrites the same row with the server's version.
        const local = await db.notes.get(remote.id);

        if (local !== undefined && local.text !== remote.text) {
          const copyId = generateId();
          const timestamp = now();
          const copyText = markConflictText(local.text);
          const copy: Note = {
            id: copyId,
            // Derived from the marked text, like every other title in the app.
            // A title that disagrees with its text IS the bug this fixes.
            title: deriveTitle(copyText),
            text: copyText,
            createdAt: timestamp,
            updatedAt: timestamp,
            pinned: false,
            trashedAt: null,
            archivedAt: null,
          };

          await db.notes.add(copy);
          await reindex(copyId, copy.text);
          // Dirty, so the copy reaches the account too. A conflict copy that
          // lives on one device is a backup the user does not have.
          await db.syncState.put({
            kind: 'note',
            key: copyId,
            syncedRev: 0,
            dirty: 1,
            deleted: 0,
            markedAt: timestamp,
          });
        }

        await db.notes.put(toNote(remote));
        await reindex(remote.id, remote.text);
        await db.syncState.put({
          kind: 'note',
          key: remote.id,
          syncedRev: remote.rev,
          dirty: 0,
          deleted: 0,
          markedAt: remote.updatedAt,
        });
      });
    }
  }

  return {
    /**
     * One pull, then one push. Never called on the render path.
     *
     * Pull first, deliberately: it costs one round trip to learn what the
     * server already holds, and pushing blind guarantees a conflict copy for
     * every note another device touched since this one last looked.
     */
    async syncOnce(accountId: string): Promise<SyncOutcome> {
      const since = await readCursor(accountId);

      const remote = await transport.pull(since);
      const pulled = (await applyNotes(remote.notes)) + (await applyTags(remote.tags));
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: remote.rev });

      const { notes, tags, snapshots } = await collect();
      if (notes.length === 0 && tags.length === 0) {
        return { pulled, pushed: 0, conflicts: 0, rev: remote.rev };
      }

      const result = await transport.push({ notes, tags });

      for (const item of result.accepted) {
        if (item.kind === 'tag') {
          const row = await db.syncState.get(['tag', item.id]);
          if (row?.deleted === 1) await db.syncState.delete(['tag', item.id]);
          else if (row !== undefined) {
            await db.syncState.put({ ...row, dirty: 0, syncedRev: result.rev });
          }
          continue;
        }

        const row = await db.syncState.get(['note', item.id]);
        if (row === undefined) continue;

        if (row.deleted === 1) {
          // The tombstone is on the server now; the bookkeeping row has done
          // its whole job and can go.
          await db.syncState.delete(['note', item.id]);
          continue;
        }

        const stored = await db.notes.get(item.id);
        const snapshot = snapshots.get(item.id);

        // The dirty-clearing rule. An edit that landed while the push was in
        // flight moved `updatedAt` past the snapshot; clearing here would
        // strand that edit on this device forever, looking perfectly saved.
        if (stored !== undefined && stored.updatedAt !== snapshot) {
          await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 1 });
          continue;
        }

        await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 0 });
      }

      await resolveConflicts(result.conflicts.notes);

      // The cursor must never move BACKWARDS. `result.rev` is the revision the
      // PUSH allocated, and a push that wrote nothing returns the current
      // counter — which can be lower than the rev the pull just reported.
      // Writing it back unconditionally rewinds the cursor and makes the next
      // pull re-scan a range this run already applied.
      const cursor = Math.max(remote.rev, result.rev);
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: cursor });

      // `rev` below is deliberately the SAME number, not `result.rev`. The
      // stored cursor and the reported revision are one value with two
      // audiences, and a status line reporting a revision lower than the one
      // this client actually holds is the same rewind wearing a different hat.
      return {
        pulled,
        pushed: result.accepted.length,
        conflicts: result.conflicts.notes.length,
        rev: cursor,
      };
    },
  };
}
