import Dexie, { type EntityTable, type Table } from 'dexie';

import type { FileRecord, Note, NoteFolds, NoteTag, SettingRecord, TagMeta } from './types';

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
  }
}

export const DATABASE_NAME = 'bear-web';

export const db = new BearDatabase(DATABASE_NAME);

// this.version(2).stores({ notes: 'id, updatedAt, createdAt, trashedAt, someNewIndex' })
//   .upgrade((tx) => tx.table('notes').toCollection().modify((n) => { n.someNewField = 0; }));
