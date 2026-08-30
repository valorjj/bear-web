import Dexie, { type EntityTable, type Table } from 'dexie';

import type {
  FileRecord,
  Note,
  NoteFolds,
  NoteLink,
  NoteTag,
  SettingRecord,
  SyncKind,
  SyncState,
  TagMeta,
} from './types';

export class BearDatabase extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  /**
   * Compound primary key `[noteId+tag]`, so this is a plain `Table` keyed by a
   * tuple. `EntityTable<NoteTag, 'noteId'>` would be wrong: it declares a single
   * named key property and makes it optional on insert, and both halves of this
   * key are required.
   */
  noteTags!: Table<NoteTag, [string, string]>;
  tags!: EntityTable<TagMeta, 'tag'>;
  files!: EntityTable<FileRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;
  noteFolds!: EntityTable<NoteFolds, 'noteId'>;
  /**
   * Compound primary key `[kind+key]`, so this is a plain `Table` keyed by a
   * tuple — the same reason `noteTags` is, and for the same reason
   * `EntityTable` would be wrong here.
   */
  syncState!: Table<SyncState, [SyncKind, string]>;
  /**
   * Compound primary key `[noteId+toTitle]`, same shape as `noteTags` and for
   * the same reason: both directions of the join (a note's own links, and who
   * links to a title) are single-index queries.
   */
  noteLinks!: Table<NoteLink, [string, string]>;

  constructor(name: string) {
    super(name);

    // `pinned` is deliberately absent from every index: IndexedDB rejects
    // boolean keys. `trashedAt` is indexed knowing the index holds only
    // trashed notes, since IndexedDB omits records with null indexed values.
    this.version(1).stores({
      notes: 'id, updatedAt, createdAt, trashedAt',
      noteTags: '[noteId+tag], noteId, tag',
      tags: 'tag, sortOrder',
      files: 'id, noteId',
      settings: 'key',
    });

    // Version 2 adds fold state. No `.upgrade()` hook: the table starts empty
    // and an absent row already means "nothing folded", so there is nothing to
    // backfill. Dexie multiplies declared versions by ten, so this is
    // IndexedDB version 20 — `e2e/fixtures/seed.ts` opens at the raw IndexedDB
    // number and must be moved with it, or the seeding connection blocks the
    // upgrade forever and the app boots to a bare `<div id="root">` with no
    // error at all.
    this.version(2).stores({
      noteFolds: 'noteId',
    });

    // Version 3 adds sync bookkeeping. No `.upgrade()` hook: an absent row
    // already means "never synced, not dirty", which is exactly right for a
    // database that predates sync — the first sync after signing in treats
    // every note as new, which is what adoption does anyway.
    //
    // Dexie multiplies declared versions by ten, so this is IndexedDB version
    // 30, and `e2e/fixtures/seed.ts` MUST move with it in the same commit.
    // `dirty` and `deleted` are indexed and therefore stored as 0 | 1;
    // IndexedDB rejects boolean keys.
    this.version(3).stores({
      syncState: '[kind+key], dirty, kind, deleted',
    });

    // Version 4 adds image metadata to `files` (`width`, `height`, `bytes`,
    // `createdAt`). The store's KEYS are unchanged — only the record shape
    // grows — but Dexie needs a version to notice at all.
    //
    // No `.upgrade()` hook, and that is safe rather than lazy: the `files`
    // repository had no call sites before K1, so no row of this shape has ever
    // been written. Inventing dimensions for a hypothetical row would be a
    // guess; the node view treats absent dimensions as an unknown ratio.
    //
    // Dexie multiplies declared versions by ten, so this is IndexedDB version
    // 40, and `e2e/fixtures/seed.ts` MUST move with it in the same commit.
    this.version(4).stores({
      files: 'id, noteId',
    });

    // Version 5 adds the L2 backlinks index. Same compound-key shape as
    // `noteTags`, and for the same reason: both directions of the join (a
    // note's own outgoing links, and who links to a title) are single-index
    // queries.
    //
    // Dexie multiplies declared versions by ten, so this is IndexedDB version
    // 50, and `e2e/fixtures/seed.ts` MUST move with it in the same commit.
    this.version(5).stores({
      noteLinks: '[noteId+toTitle], noteId, toTitle',
    });
  }
}

export const DATABASE_NAME = 'bear-web';

export const db = new BearDatabase(DATABASE_NAME);

// this.version(2).stores({ notes: 'id, updatedAt, createdAt, trashedAt, someNewIndex' })
//   .upgrade((tx) => tx.table('notes').toCollection().modify((n) => { n.someNewField = 0; }));
