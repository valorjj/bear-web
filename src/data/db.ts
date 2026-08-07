import Dexie, { type EntityTable, type Table } from 'dexie';

import type { FileRecord, Note, NoteTag, SettingRecord, TagMeta } from './types';

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
  }
}

export const DATABASE_NAME = 'bear-web';

export const db = new BearDatabase(DATABASE_NAME);

// this.version(2).stores({ notes: 'id, updatedAt, createdAt, trashedAt, someNewIndex' })
//   .upgrade((tx) => tx.table('notes').toCollection().modify((n) => { n.someNewField = 0; }));
