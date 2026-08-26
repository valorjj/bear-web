import type { BearDatabase } from '../db';
import { markDirty } from '../sync/markDirty';
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
  /**
   * Stores an image fetched from the server, under the id it already has.
   *
   * NOT `add`: that generates an id and queues an upload, and both would be
   * wrong here — the id is the server's, and re-uploading what was just
   * downloaded is a round trip for nothing.
   *
   * `noteId` is empty, deliberately. A downloading device does not know which
   * note asked, and inventing one would put a wrong owner in the row. It costs
   * nothing: the boot sweep asks whether ANY note references the id, not who
   * owns it.
   */
  addDownloaded(id: string, blob: Blob, now: number): Promise<FileRecord>;
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
      await db.transaction('rw', db.files, db.syncState, async () => {
        await db.files.add(record);
        // Queued for upload by the sync engine rather than uploaded here: a
        // paste must not wait on the network, and an offline paste must still
        // work exactly as it does today.
        await markDirty(db, 'image', record.id, record.createdAt);
      });
      return record;
    },
    async addDownloaded(id, blob, at) {
      const record: FileRecord = {
        id,
        noteId: '',
        blob,
        mime: blob.type === '' ? 'image/webp' : blob.type,
        // Unknown until the image decodes, and not worth decoding for: the
        // node view falls back to an unreserved box, which reflows once.
        width: 0,
        height: 0,
        bytes: blob.size,
        createdAt: at,
      };
      // `put`, not `add`: two views can race to fetch the same image, and the
      // second must not throw a ConstraintError on a duplicate key.
      await db.files.put(record);
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
