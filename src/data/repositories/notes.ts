import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { normalizeTitle, type TitledNote } from '../links';
import { compareNotes, DEFAULT_NOTE_ORDER, type NoteOrder } from '../order';
import { newId } from '../ids';
import { reindexNote } from '../reindex';
import { markDeleted, markDirty } from '../sync/markDirty';
import type { Note, NoteLink, NoteTag } from '../types';

export type TagParser = (markdown: string) => string[];
export type LinkParser = (markdown: string) => string[];

export interface NotesRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  parseLinks: LinkParser;
  now?: () => number;
  generateId?: () => string;
}

export interface ListByTagOptions {
  order?: NoteOrder;
  /** `false` is the "hide sub-tag notes" preference. */
  includeDescendants?: boolean;
}

export interface NotesRepository {
  create(text?: string): Promise<Note>;
  /**
   * A fresh, unpinned note holding a copy of `id`'s text. Rejects if `id` is
   * gone, the same as every other method that names an existing note.
   */
  duplicate(id: string): Promise<Note>;
  get(id: string): Promise<Note | undefined>;
  save(id: string, text: string): Promise<Note>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  listActive(order?: NoteOrder): Promise<Note[]>;
  listTrashed(): Promise<Note[]>;
  tagsOf(id: string): Promise<string[]>;
  rebuildTagIndex(): Promise<number>;
  /**
   * Active notes carrying `tag`, and by default any descendant of it.
   * `includeDescendants: false` is the "hide sub-tag notes" preference.
   */
  listByTag(tag: string, options?: ListByTagOptions): Promise<Note[]>;
  /** Every row of the derived tag index. The sidebar's only door to it. */
  allTagRows(): Promise<NoteTag[]>;
  /** Active notes whose text links to `title`, in `[[…]]` form. Normalizes `title` itself. */
  linksTo(title: string): Promise<Note[]>;
  rebuildLinkIndex(): Promise<number>;
  /** Every row of the derived link index. */
  allLinkRows(): Promise<NoteLink[]>;
  /** Titles of every non-trashed note. What `[[` autocomplete and link-pill resolution match against. */
  allNoteTitles(): Promise<string[]>;
  /**
   * `{ id, title, updatedAt }` for every non-trashed note — what L3's graph
   * needs to place a node and what `buildTitleIndex` needs to resolve a link
   * target. Projects away `text` deliberately: the graph reads every note at
   * once, and the markdown is the only large field.
   */
  allNoteIndex(): Promise<TitledNote[]>;
}

export function createNotesRepository(deps: NotesRepositoryDeps): NotesRepository {
  const { db, parseTags, parseLinks } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /** Named `requireNote`, not `require` — shadowing the CommonJS global invites trouble. */
  async function requireNote(id: string): Promise<Note> {
    const note = await db.notes.get(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    return note;
  }

  /**
   * Pinned first, then the caller's chosen order. Applied to every non-trash
   * lister so a pinned note is pinned everywhere it appears, not only in the
   * Pinned list.
   *
   * The pinned partition is applied FIRST and unconditionally: the user's order
   * is the tiebreaker WITHIN each partition, never something that can lift an
   * unpinned note above a pinned one. Otherwise pinning would mean something
   * different from the Pinned smart list.
   *
   * `pinned` cannot drive an IndexedDB index — booleans are not valid keys —
   * so this is an in-memory sort, which is also why `listActive` already
   * filters in memory.
   */
  function byPinnedThen(order: NoteOrder): (a: Note, b: Note) => number {
    const within = compareNotes(order);
    return (a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return within(a, b);
    };
  }

  async function create(text = ''): Promise<Note> {
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

    await db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
      await db.notes.add(note);
      await reindexNote(db, note.id, text, parseTags, parseLinks, note.title);
      await markDirty(db, 'note', note.id, timestamp);
    });

    return note;
  }

  return {
    create,

    /**
     * The copy is a NEW note in every respect the row shows: its own id, its
     * own timestamps, and unpinned regardless of the source. Duplicating a
     * pinned note to another pinned note would put the copy directly above
     * the original at the top of the list, where the two are indistinguishable
     * — and the user pinned one note, not two.
     *
     * The text is copied verbatim, tags included. A tag is part of what the
     * note SAYS in this app's grammar, so stripping them would be editing the
     * user's words; the tag index picks the copy up through `create`.
     */
    async duplicate(id) {
      const source = await requireNote(id);
      return create(source.text);
    },

    async get(id) {
      return db.notes.get(id);
    },

    async save(id, text) {
      return db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
        const existing = await requireNote(id);
        const timestamp = now();
        const updated: Note = {
          ...existing,
          text,
          title: deriveTitle(text),
          updatedAt: timestamp,
        };

        await db.notes.put(updated);
        await reindexNote(db, id, text, parseTags, parseLinks, updated.title);

        await markDirty(db, 'note', id, timestamp);

        return updated;
      });
    },

    async setPinned(id, pinned) {
      await db.transaction('rw', db.notes, db.syncState, async () => {
        await requireNote(id);
        const timestamp = now();
        await db.notes.update(id, { pinned, updatedAt: timestamp });
        await markDirty(db, 'note', id, timestamp);
      });
    },

    async trash(id) {
      // The tag and link indexes reflect active notes only (see
      // rebuildTagIndex / rebuildLinkIndex), so a trashed note's rows are
      // removed here to keep every path agreeing.
      await db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
        await requireNote(id);
        const timestamp = now();
        await db.notes.update(id, { trashedAt: timestamp, updatedAt: timestamp });
        await db.noteTags.where('noteId').equals(id).delete();
        await db.noteLinks.where('noteId').equals(id).delete();
        await markDirty(db, 'note', id, timestamp);
      });
    },

    async restore(id) {
      // Reindex from the note's text, exactly as `save` does: a rebuild that
      // ran while this note was trashed would have dropped its tag and link
      // rows, and restoring must not leave them permanently gone.
      await db.transaction('rw', db.notes, db.noteTags, db.noteLinks, db.syncState, async () => {
        const note = await requireNote(id);
        const timestamp = now();
        await db.notes.update(id, { trashedAt: null, updatedAt: timestamp });
        await reindexNote(db, id, note.text, parseTags, parseLinks, note.title);
        await markDirty(db, 'note', id, timestamp);
      });
    },

    /**
     * Purging an absent id is intentionally a no-op, unlike its siblings
     * (`save`, `setPinned`, `trash`, `restore`), which reject via `requireNote`.
     * Delete idempotency is defensible: callers retrying a purge, or racing
     * with another tab's purge of the same note, should not see an error.
     */
    async purge(id) {
      await db.transaction(
        'rw',
        [db.notes, db.noteTags, db.noteLinks, db.files, db.noteFolds, db.syncState],
        async () => {
          await db.noteTags.where('noteId').equals(id).delete();
          await db.noteLinks.where('noteId').equals(id).delete();
          await db.files.where('noteId').equals(id).delete();
          await db.noteFolds.delete(id);
          await db.notes.delete(id);
          await markDeleted(db, 'note', id, now());
        },
      );
    },

    async emptyTrash() {
      return db.transaction(
        'rw',
        [db.notes, db.noteTags, db.noteLinks, db.files, db.noteFolds, db.syncState],
        async () => {
          // The trashedAt index holds only trashed notes, since IndexedDB omits
          // nulls. Use aboveOrEqual(0), not above(0), so a note trashed at epoch
          // 0 is still purged.
          const trashed = await db.notes.where('trashedAt').aboveOrEqual(0).toArray();
          const ids = trashed.map((n) => n.id);
          const timestamp = now();

          await db.noteTags.where('noteId').anyOf(ids).delete();
          await db.noteLinks.where('noteId').anyOf(ids).delete();
          await db.files.where('noteId').anyOf(ids).delete();
          await db.noteFolds.bulkDelete(ids);
          await db.notes.bulkDelete(ids);
          for (const purgedId of ids) await markDeleted(db, 'note', purgedId, timestamp);

          return ids.length;
        },
      );
    },

    async listActive(order = DEFAULT_NOTE_ORDER) {
      // `pinned` and `trashedAt === null` cannot drive an index here; see db.ts.
      const all = await db.notes.toArray();
      return all.filter((n) => n.trashedAt === null).sort(byPinnedThen(order));
    },

    async listTrashed() {
      // Deliberately takes NO order. Trash orders by deletion time, which is
      // not one of NoteOrder's three fields; the menu renders the sort group
      // disabled here rather than accepting a setting it would ignore.
      //
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

    async rebuildLinkIndex() {
      return db.transaction('rw', db.notes, db.noteLinks, async () => {
        await db.noteLinks.clear();

        const all = await db.notes.toArray();
        const rows = all
          .filter((n) => n.trashedAt === null)
          .flatMap((n) => {
            const ownTitle = normalizeTitle(n.title);
            return [...new Set(parseLinks(n.text))]
              .filter((title) => title !== ownTitle)
              .map((toTitle) => ({ noteId: n.id, toTitle }));
          });

        await db.noteLinks.bulkPut(rows);
        return rows.length;
      });
    },

    async listByTag(tag, options = {}) {
      const { order = DEFAULT_NOTE_ORDER, includeDescendants = true } = options;

      // Two queries, not one: selecting a parent covers its descendants, and
      // including the `/` in the prefix is what stops `work` matching
      // `workflow`. Hiding sub-tag notes is therefore one skipped query.
      const [exact, descendants] = await Promise.all([
        db.noteTags.where('tag').equals(tag).toArray(),
        includeDescendants
          ? db.noteTags.where('tag').startsWith(`${tag}/`).toArray()
          : Promise.resolve([]),
      ]);

      const ids = [...new Set([...exact, ...descendants].map((row) => row.noteId))];
      const found = await db.notes.bulkGet(ids);

      return found
        .filter((note): note is Note => note !== undefined && note.trashedAt === null)
        .sort(byPinnedThen(order));
    },

    async allTagRows() {
      return db.noteTags.toArray();
    },

    async linksTo(title) {
      // `normalizeTitle` is the ONLY place a title becomes a key — normalizing
      // here, on the query side, so an un-normalized caller-supplied title
      // still finds what the index side stored normalized.
      const key = normalizeTitle(title);
      const rows = await db.noteLinks.where('toTitle').equals(key).toArray();
      const ids = [...new Set(rows.map((row) => row.noteId))];
      const found = await db.notes.bulkGet(ids);

      return found.filter((note): note is Note => note !== undefined && note.trashedAt === null);
    },

    async allLinkRows() {
      return db.noteLinks.toArray();
    },

    async allNoteTitles() {
      const all = await db.notes.toArray();
      return all.filter((n) => n.trashedAt === null).map((n) => n.title);
    },

    async allNoteIndex() {
      const all = await db.notes.toArray();
      return all
        .filter((n) => n.trashedAt === null)
        .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
    },
  };
}
