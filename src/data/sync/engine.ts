import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { newId } from '../ids';
import { reindexNote } from '../reindex';
import type { Note, TagMeta } from '../types';
import type { PushNote, PushTag, RemoteNote, RemoteTag, Transport } from './transport';

/**
 * The prefix every sync bookkeeping key in the `settings` table carries.
 *
 * Exported so `backup.ts` can exclude these keys from an exported bundle
 * without hardcoding a second copy of the list: they describe THIS device's
 * relationship with THIS account's server copy, and a restore that inherited
 * them would inherit a stranger's cursor.
 */
export const SYNC_SETTING_PREFIX = 'sync:';

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

/** A dirty row as `collect` found it, kept so accept can tell what it pushed. */
interface PushSnapshot {
  markedAt: number;
  deleted: 0 | 1;
}

/**
 * Snapshot key. Notes and tags share one map and a tag is keyed by NAME, so
 * a note whose id happened to equal a tag name would otherwise collide.
 */
function snapshotKey(kind: 'note' | 'tag', key: string): string {
  return `${kind}:${key}`;
}

export interface EngineDeps {
  db: BearDatabase;
  transport: Transport;
  parseTags: (markdown: string) => string[];
  parseLinks: (markdown: string) => string[];
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

  const line = lines[index]!;
  // A trailing `\r` is this line's ENDING, not trailing whitespace. Stripping
  // it would rewrite CRLF text's line endings on exactly one line, and
  // appending after it would put the marker beyond the end of the line.
  const ending = line.endsWith('\r') ? '\r' : '';
  const body = line.slice(0, line.length - ending.length).replace(/[ \t]+$/, '');

  lines[index] = `${body} (conflict)${ending}`;
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
  const { db, transport, parseTags, parseLinks } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /**
   * Replaces a note's derived tag AND link rows.
   *
   * Deliberately the SHARED `reindexNote` that `repositories/notes.ts` calls,
   * not a private copy: the tag index has already disagreed with its own
   * rebuild once in this project's history, and a second implementation of
   * "how tags (or links) are derived from text" is exactly how that
   * regresses. A note arriving from another device that skipped this call
   * would get tag rows and no link rows — an incompleteness that only shows
   * up after a sync, which is the hardest kind of bug to reproduce.
   *
   * `deriveTitle(text)` is the same derivation `toNote` uses for the note's
   * own title, so a self-link in a pulled note is dropped exactly as it is
   * for a locally-edited one.
   */
  async function reindex(noteId: string, text: string): Promise<void> {
    await reindexNote(db, noteId, text, parseTags, parseLinks, deriveTitle(text));
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
          [db.notes, db.noteTags, db.noteLinks, db.files, db.noteFolds, db.syncState],
          async () => {
            await db.noteTags.where('noteId').equals(remote.id).delete();
            await db.noteLinks.where('noteId').equals(remote.id).delete();
            await db.files.where('noteId').equals(remote.id).delete();
            await db.noteFolds.delete(remote.id);
            await db.notes.delete(remote.id);
            await db.syncState.delete(['note', remote.id]);
          },
        );
      } else {
        await db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
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

  /**
   * Uploads every image this device has not yet sent.
   *
   * One failure never aborts the rest, and never aborts the sync: an account
   * at quota, or one image the server refuses, must not stop the others or
   * leave the run looking broken. A refused image stays DIRTY and stays
   * LOCAL — dropping it would destroy data because the server declined to
   * hold a copy of it.
   */
  async function uploadImages(): Promise<number> {
    const dirty = await db.syncState.where('dirty').equals(1).toArray();
    let uploaded = 0;

    for (const row of dirty) {
      if (row.kind !== 'image') continue;

      const file = await db.files.get(row.key);
      if (file === undefined) {
        // Reclaimed locally before it was ever uploaded. Nothing to send and
        // nothing to remember.
        await db.syncState.delete(['image', row.key]);
        continue;
      }

      try {
        await transport.uploadImage(file.id, file.noteId, file.blob, file.width, file.height);
        await db.syncState.put({ ...row, dirty: 0 });
        uploaded += 1;
      } catch {
        // Left dirty on purpose: quota, offline, or a server that is down are
        // all states the next sync should retry from.
      }
    }

    return uploaded;
  }

  /** Collects everything dirty, with the revision each row last saw as its `baseRev`. */
  async function collect(): Promise<{
    notes: PushNote[];
    tags: PushTag[];
    snapshots: Map<string, PushSnapshot>;
  }> {
    const dirty = await db.syncState.where('dirty').equals(1).toArray();
    const notes: PushNote[] = [];
    const tags: PushTag[] = [];
    // What the bookkeeping row looked like at the moment of collection, per
    // row. Compared against the CURRENT row on accept, so neither an edit
    // nor a purge landing mid-flight can be cleared as though the server had
    // already heard about it.
    const snapshots = new Map<string, PushSnapshot>();

    for (const row of dirty) {
      // Images are pushed by `uploadImages`, not by the JSON batch: they carry
      // bytes, no revision, and no conflict story. Skipped here so they never
      // reach `snapshotKey`, which is typed for the two kinds that do.
      if (row.kind === 'image') continue;

      snapshots.set(snapshotKey(row.kind, row.key), {
        markedAt: row.markedAt,
        deleted: row.deleted,
      });

      if (row.kind === 'note') {
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
      await db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
        // Read INSIDE the transaction that then writes from it: this decides
        // whether a copy is needed and is immediately followed by the write
        // that overwrites the same row with the server's version.
        const local = await db.notes.get(remote.id);

        // TEXT alone decides whether a copy is made. The copy exists to
        // preserve text the server is about to overwrite; when the text is
        // identical there is nothing to preserve and a copy is pure
        // duplication. That includes the case where two devices trashed the
        // same note at different milliseconds — comparing `trashedAt` here
        // would mint a visible copy and resurrect, on every device, a note the
        // user deleted on both. A conflict differing only in `pinned` /
        // `trashedAt` / `archivedAt` resolves by last-write-wins, this
        // project's documented rule: the cost is a trash-intent the user may
        // have to repeat, and nothing is destroyed.
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
            // Deliberately visible: never trashed, never pinned, whatever the
            // local row was. A copy the user cannot find in the note list is
            // not a copy at all — and a conflict whose only difference WAS a
            // local trash would otherwise produce an invisible one.
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

  /**
   * Takes the server's copy of a conflicted tag and clears the local claim.
   *
   * There is no `(conflict)` copy for tags, and there must not be: a tag row
   * is METADATA — order, icon, collapsed — not content, and the spec resolves
   * tag metadata by per-row last-write-wins. Nothing the user typed is lost by
   * taking the server's values.
   *
   * Without this the row never converges. A conflicted tag is absent from
   * `accepted`, so the accept loop never touches it; `applyTags` skipped the
   * server's copy because the row was dirty; and the cursor has already moved
   * past the server's revision for it. The row would sit at `dirty: 1` with
   * its old `syncedRev` forever — re-pushed every sync, conflicted every time,
   * with the two devices' tag order permanently disagreeing. This is not a
   * rare race: tags are keyed by NAME, so on guest adoption (where
   * `markAllDirty` marks every tag dirty at `syncedRev: 0`) EVERY tag the
   * account already holds conflicts on a second device's first sync.
   */
  async function resolveTagConflicts(remotes: RemoteTag[]): Promise<void> {
    for (const remote of remotes) {
      await db.transaction('rw', db.tags, db.syncState, async () => {
        if (remote.deleted) {
          await db.tags.delete(remote.tag);
          await db.syncState.delete(['tag', remote.tag]);
          return;
        }

        await db.tags.put(toTagMeta(remote));
        await db.syncState.put({
          kind: 'tag',
          key: remote.tag,
          syncedRev: remote.rev,
          dirty: 0,
          deleted: 0,
          markedAt: now(),
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

      // NOT an early return any more. An account whose only dirty rows are
      // images must still upload them, and returning here skipped that
      // entirely — the images would sit dirty until the user happened to edit
      // a note.
      if (notes.length === 0 && tags.length === 0) {
        await uploadImages();
        return { pulled, pushed: 0, conflicts: 0, rev: remote.rev };
      }

      const result = await transport.push({ notes, tags });

      for (const item of result.accepted) {
        if (item.kind === 'tag') {
          const row = await db.syncState.get(['tag', item.id]);
          if (row === undefined) continue;

          const snapshot = snapshots.get(snapshotKey('tag', item.id));

          // The tag in-flight-edit guard, the counterpart of the note one
          // below. `TagMeta` carries no `updatedAt`, so `markedAt` — stamped
          // by `markDirty` at the moment of the local write — is the only
          // thing that can distinguish "the row this run pushed" from "a row
          // rewritten while the push was in flight". Clearing `dirty`
          // unconditionally strands that later edit on this device forever,
          // looking perfectly saved.
          if (row.markedAt !== snapshot?.markedAt) {
            await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 1 });
            continue;
          }

          if (row.deleted === 1) await db.syncState.delete(['tag', item.id]);
          else await db.syncState.put({ ...row, dirty: 0, syncedRev: result.rev });
          continue;
        }

        const row = await db.syncState.get(['note', item.id]);
        const snapshot = snapshots.get(snapshotKey('note', item.id));

        if (row === undefined) {
          // The tombstone this run pushed did its job and something already
          // tidied the row away. Nothing is owed.
          if (snapshot?.deleted === 1) continue;

          // Otherwise the note was purged while the push was in flight, and
          // `markDeleted` dropped the row outright because `syncedRev` was 0.
          // The server has just been handed a note the user deleted, and the
          // only thing that could ever ask for it back is a bookkeeping row —
          // so put one back, owing a tombstone.
          await db.syncState.put({
            kind: 'note',
            key: item.id,
            syncedRev: result.rev,
            dirty: 1,
            deleted: 1,
            markedAt: now(),
          });
          continue;
        }

        if (row.deleted === 1) {
          // Only when the row this run actually PUSHED was itself a tombstone,
          // and nothing has touched it since. Otherwise what the server
          // accepted was the EDIT and the purge landed mid-flight: dropping
          // the row here would leave the note gone locally, alive on the
          // server, and past the cursor — permanent divergence with no error.
          if (snapshot?.deleted === 1 && row.markedAt === snapshot.markedAt) {
            await db.syncState.delete(['note', item.id]);
          } else {
            await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 1 });
          }
          continue;
        }

        const stored = await db.notes.get(item.id);

        // The dirty-clearing rule. An edit that landed while the push was in
        // flight moved `updatedAt` past the snapshot; clearing here would
        // strand that edit on this device forever, looking perfectly saved.
        if (stored !== undefined && stored.updatedAt !== snapshot?.markedAt) {
          await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 1 });
          continue;
        }

        await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 0 });
      }

      await resolveConflicts(result.conflicts.notes);
      await resolveTagConflicts(result.conflicts.tags);

      // AFTER the note push, deliberately. Either order leaves a recoverable
      // state — a note whose image has not arrived shows the placeholder, and
      // so does an image whose note has not — so the order is chosen for a
      // different reason: pushing notes first means a quota refusal on an
      // image cannot stop the note's own TEXT from ever reaching the server.
      // Text matters more than pixels.
      await uploadImages();

      // The cursor is the PULL's rev and nothing else. It was already written
      // above, immediately after the pull was applied, and this run's push
      // must not touch it.
      //
      // The two revisions mean different things. `remote.rev` is the account's
      // counter as of the pull: a DELIVERY WATERMARK, "everything allocated up
      // to here has now been handed to this device". `result.rev` is merely
      // the revision THIS push allocated, which says nothing about revisions
      // another device allocated in between. Because a push allocates after
      // the pull has already returned, `result.rev` is always >= `remote.rev`
      // — so storing it (or `Math.max` of the two, which selects it for the
      // same reason) silently skips every revision another device wrote
      // between the two legs. Device B pushes note X at rev 11 while this
      // device is mid-run; this device allocates 12; a cursor of 12 means
      // `since=12` next time and X is NEVER delivered again unless B happens
      // to edit it a second time. A note written on one device silently never
      // reaches the other.
      //
      // The cost of the correct rule is that this run's own pushed rows come
      // back on the next pull and are re-applied identically — the row is no
      // longer dirty by then, so `applyNotes`/`applyTags` write exactly what
      // is already stored. Harmless, and far cheaper than losing a note.
      return {
        pulled,
        pushed: result.accepted.length,
        conflicts: result.conflicts.notes.length + result.conflicts.tags.length,
        rev: remote.rev,
      };
    },
  };
}
