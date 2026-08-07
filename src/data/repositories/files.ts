import type { BearDatabase } from '../db';
import { newId } from '../ids';
import type { FileRecord } from '../types';

export interface FilesRepositoryDeps {
  db: BearDatabase;
  generateId?: () => string;
}

export interface FilesRepository {
  add(noteId: string, blob: Blob, mime: string): Promise<FileRecord>;
  get(id: string): Promise<FileRecord | undefined>;
  listForNote(noteId: string): Promise<FileRecord[]>;
  remove(id: string): Promise<void>;
  removeForNote(noteId: string): Promise<number>;
}

export function createFilesRepository(deps: FilesRepositoryDeps): FilesRepository {
  const { db } = deps;
  const generateId = deps.generateId ?? newId;

  return {
    async add(noteId, blob, mime) {
      const record: FileRecord = { id: generateId(), noteId, blob, mime };
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
