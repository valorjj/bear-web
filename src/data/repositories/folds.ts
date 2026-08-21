import type { BearDatabase } from '../db';

export interface FoldsRepository {
  /** The fold keys for a note. An absent row is an empty list, never an error. */
  get(noteId: string): Promise<string[]>;
  /** Replaces the note's whole fold set. An empty array clears it. */
  set(noteId: string, keys: string[]): Promise<void>;
  remove(noteId: string): Promise<void>;
}

export function createFoldsRepository(db: BearDatabase): FoldsRepository {
  return {
    async get(noteId) {
      const row = await db.noteFolds.get(noteId);
      return row?.keys ?? [];
    },

    async set(noteId, keys) {
      // A whole-row replace, not a merge: unfolding the last section must
      // leave nothing behind, and an empty row is cheaper to reason about
      // than a delete-when-empty special case.
      await db.noteFolds.put({ noteId, keys });
    },

    async remove(noteId) {
      await db.noteFolds.delete(noteId);
    },
  };
}
