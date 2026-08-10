import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { newId } from '../ids';
import type { Note, NoteTag } from '../types';

export type TagParser = (markdown: string) => string[];

export interface NotesRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  now?: () => number;
  generateId?: () => string;
}

export interface NotesRepository {
  create(text?: string): Promise<Note>;
  get(id: string): Promise<Note | undefined>;
  save(id: string, text: string): Promise<Note>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  listActive(): Promise<Note[]>;
  listTrashed(): Promise<Note[]>;
  tagsOf(id: string): Promise<string[]>;
  rebuildTagIndex(): Promise<number>;
  /** Active notes carrying `tag` or any descendant of it, newest first. */
  listByTag(tag: string): Promise<Note[]>;
  /** Every row of the derived tag index. The sidebar's only door to it. */
  allTagRows(): Promise<NoteTag[]>;
}

export function createNotesRepository(deps: NotesRepositoryDeps): NotesRepository {
  const { db, parseTags } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /** Replaces this note's derived tag rows to match its current text. */
  async function reindex(noteId: string, text: string): Promise<void> {
    const tags = [...new Set(parseTags(text))];

    await db.noteTags.where('noteId').equals(noteId).delete();
    if (tags.length > 0) {
      await db.noteTags.bulkPut(tags.map((tag) => ({ noteId, tag })));
    }
  }

  /** Named `requireNote`, not `require` — shadowing the CommonJS global invites trouble. */
  async function requireNote(id: string): Promise<Note> {
    const note = await db.notes.get(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    return note;
  }

  return {
    async create(text = '') {
      const timestamp = now();
      const note: Note = {
        id: generateId(),
        title: deriveTitle(text),
        text,
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      };

      await db.transaction('rw', db.notes, db.noteTags, async () => {
        await db.notes.add(note);
        await reindex(note.id, text);
      });

      return note;
    },

    async get(id) {
      return db.notes.get(id);
    },

    async save(id, text) {
      return db.transaction('rw', db.notes, db.noteTags, async () => {
        const existing = await requireNote(id);
        const updated: Note = {
          ...existing,
          text,
          title: deriveTitle(text),
          updatedAt: now(),
        };

        await db.notes.put(updated);
        await reindex(id, text);

        return updated;
      });
    },

    async setPinned(id, pinned) {
      await db.transaction('rw', db.notes, async () => {
        await requireNote(id);
        await db.notes.update(id, { pinned });
      });
    },

    async trash(id) {
      // The tag index reflects active notes only (see rebuildTagIndex), so a
      // trashed note's rows are removed here to keep both paths agreeing.
      await db.transaction('rw', db.notes, db.noteTags, async () => {
        await requireNote(id);
        await db.notes.update(id, { trashedAt: now() });
        await db.noteTags.where('noteId').equals(id).delete();
      });
    },

    async restore(id) {
      // Reindex from the note's text, exactly as `save` does: a rebuild that
      // ran while this note was trashed would have dropped its tag rows, and
      // restoring must not leave them permanently gone.
      await db.transaction('rw', db.notes, db.noteTags, async () => {
        const note = await requireNote(id);
        await db.notes.update(id, { trashedAt: null });
        await reindex(id, note.text);
      });
    },

    /**
     * Purging an absent id is intentionally a no-op, unlike its siblings
     * (`save`, `setPinned`, `trash`, `restore`), which reject via `requireNote`.
     * Delete idempotency is defensible: callers retrying a purge, or racing
     * with another tab's purge of the same note, should not see an error.
     */
    async purge(id) {
      await db.transaction('rw', db.notes, db.noteTags, db.files, async () => {
        await db.noteTags.where('noteId').equals(id).delete();
        await db.files.where('noteId').equals(id).delete();
        await db.notes.delete(id);
      });
    },

    async emptyTrash() {
      return db.transaction('rw', db.notes, db.noteTags, db.files, async () => {
        // The trashedAt index holds only trashed notes, since IndexedDB omits
        // nulls. Use aboveOrEqual(0), not above(0), so a note trashed at epoch
        // 0 is still purged.
        const trashed = await db.notes.where('trashedAt').aboveOrEqual(0).toArray();
        const ids = trashed.map((n) => n.id);

        await db.noteTags.where('noteId').anyOf(ids).delete();
        await db.files.where('noteId').anyOf(ids).delete();
        await db.notes.bulkDelete(ids);

        return ids.length;
      });
    },

    async listActive() {
      // `pinned` and `trashedAt === null` cannot drive an index here; see db.ts.
      const all = await db.notes.orderBy('updatedAt').reverse().toArray();
      return all.filter((n) => n.trashedAt === null);
    },

    async listTrashed() {
      // aboveOrEqual(0), not above(0): a note trashed at epoch 0 must still
      // appear here. IndexedDB omits null-valued records from the index, so
      // this still matches only trashed notes.
      const trashed = await db.notes.where('trashedAt').aboveOrEqual(0).toArray();
      return trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    },

    async tagsOf(id) {
      const rows = await db.noteTags.where('noteId').equals(id).toArray();
      return rows.map((r) => r.tag);
    },

    async rebuildTagIndex() {
      return db.transaction('rw', db.notes, db.noteTags, async () => {
        await db.noteTags.clear();

        const all = await db.notes.toArray();
        const rows = all
          .filter((n) => n.trashedAt === null)
          .flatMap((n) => [...new Set(parseTags(n.text))].map((tag) => ({ noteId: n.id, tag })));

        await db.noteTags.bulkPut(rows);
        return rows.length;
      });
    },

    async listByTag(tag) {
      // Two queries, not one: selecting a parent covers its descendants, and
      // including the `/` in the prefix is what stops `work` matching
      // `workflow`.
      const [exact, descendants] = await Promise.all([
        db.noteTags.where('tag').equals(tag).toArray(),
        db.noteTags.where('tag').startsWith(`${tag}/`).toArray(),
      ]);

      const ids = [...new Set([...exact, ...descendants].map((row) => row.noteId))];
      const found = await db.notes.bulkGet(ids);

      return found
        .filter((note): note is Note => note !== undefined && note.trashedAt === null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async allTagRows() {
      return db.noteTags.toArray();
    },
  };
}
