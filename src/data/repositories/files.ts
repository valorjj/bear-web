import type { BearDatabase } from '../db';
import { newId } from '../ids';
import type { FileRecord } from '../types';

export interface FilesRepositoryDeps {
  db: BearDatabase;
  generateId?: () => string;
  now?: () => number;
}

export interface FileMeta {
  mime: string;
  width: number;
  height: number;
}

export interface FilesRepository {
  /**
   * `bytes` and `createdAt` are DERIVED, never taken from the caller: the blob
   * already knows its own size, and a caller-supplied number would be a second
   * source of truth for the same fact.
   */
  add(noteId: string, blob: Blob, meta: FileMeta): Promise<FileRecord>;
  get(id: string): Promise<FileRecord | undefined>;
  listForNote(noteId: string): Promise<FileRecord[]>;
  remove(id: string): Promise<void>;
  removeForNote(noteId: string): Promise<number>;
}

export function createFilesRepository(deps: FilesRepositoryDeps): FilesRepository {
  const { db } = deps;
  const generateId = deps.generateId ?? newId;
  const now = deps.now ?? (() => Date.now());

  return {
    async add(noteId, blob, meta) {
      const record: FileRecord = {
        id: generateId(),
        noteId,
        blob,
        mime: meta.mime,
        width: meta.width,
        height: meta.height,
        bytes: blob.size,
        createdAt: now(),
      };
      await db.files.add(record);
      return record;
    },
    async get(id) {
      return db.files.get(id);
    },
    async listForNote(noteId) {
      return db.files.where('noteId').equals(noteId).toArray();
    },
    async remove(id) {
      await db.files.delete(id);
    },
    async removeForNote(noteId) {
      return db.files.where('noteId').equals(noteId).delete();
    },
  };
}
