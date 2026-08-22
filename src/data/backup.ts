import type { BearDatabase } from './db';
import { deriveTitle } from './derive';
import { markAllDirty } from './sync/markDirty';
import type { BackupBundle, SerializedFile } from './types';

export const BACKUP_FORMAT = 'bear-web-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export interface ImportResult {
  notes: number;
  noteTags: number;
  tags: number;
  files: number;
  settings: number;
}

export interface ImportDeps {
  /**
   * Rebuilds the derived tag index from note text. Injected because
   * `backup.ts` has no tag parser and must not acquire one.
   */
  rebuildTagIndex: () => Promise<number>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportDatabase(db: BearDatabase): Promise<BackupBundle> {
  const [notes, noteTags, tags, fileRecords, settings] = await Promise.all([
    db.notes.toArray(),
    db.noteTags.toArray(),
    db.tags.toArray(),
    db.files.toArray(),
    db.settings.toArray(),
  ]);

  const files: SerializedFile[] = await Promise.all(
    fileRecords.map(async (f) => ({
      id: f.id,
      noteId: f.noteId,
      mime: f.mime,
      data: await blobToBase64(f.blob),
    })),
  );

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    notes,
    noteTags,
    tags,
    files,
    settings,
  };
}

function assertBundle(candidate: unknown): asserts candidate is BackupBundle {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('Import failed: the payload is not a bear-web backup.');
  }

  const bundle = candidate as Partial<BackupBundle>;

  if (bundle.format !== BACKUP_FORMAT) {
    throw new Error('Import failed: the payload is not a bear-web backup.');
  }

  if (typeof bundle.schemaVersion !== 'number') {
    throw new Error('Import failed: the backup has no schema version.');
  }

  if (bundle.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Import failed: the backup was written by a newer version of bear-web ` +
        `(schema ${bundle.schemaVersion}, this build understands ${BACKUP_SCHEMA_VERSION}).`,
    );
  }

  for (const table of ['notes', 'noteTags', 'tags', 'files', 'settings'] as const) {
    if (!Array.isArray(bundle[table])) {
      throw new Error(`Import failed: the backup is missing its "${table}" table.`);
    }
  }
}

/**
 * Replaces the entire database with the bundle's contents. Validation happens
 * before anything is cleared, so a rejected import leaves existing data intact.
 */
export async function importDatabase(
  db: BearDatabase,
  payload: unknown,
  deps: ImportDeps,
): Promise<ImportResult> {
  assertBundle(payload);
  const bundle = payload;

  const files = bundle.files.map((f) => ({
    id: f.id,
    noteId: f.noteId,
    mime: f.mime,
    blob: base64ToBlob(f.data, f.mime),
  }));

  // Recompute `title` rather than trust the bundle: a hand-edited or stale
  // backup can carry a title that disagrees with its text.
  const notes = bundle.notes.map((n) => ({ ...n, title: deriveTitle(n.text) }));

  let rebuiltRows = 0;

  // `noteFolds` is cleared here too, alongside the other tables, even though
  // it is deliberately absent from `assertBundle`'s required-table loop and
  // from `exportDatabase` below: fold state is view state, not content (see
  // the B1 spec's "Persistence" section,
  // `docs/superpowers/specs/2026-08-20-b1-collapsible-headings-design.md`),
  // so a restore should never carry it in — but a replace-only
  // import must still leave the table consistent with the notes that now
  // exist. Without this, fold rows from the database being REPLACED survive
  // the import as orphans, and worse, a note id that happens to match one
  // (the common case: a user re-importing their own backup) reopens with a
  // section folded that was never folded in the restored database.
  // The array form of `transaction`, not the up-to-five-tables overload: six
  // tables (five original plus `noteFolds`) exceed Dexie's fixed-arity
  // overloads, which stop at five.
  await db.transaction(
    'rw',
    [db.notes, db.noteTags, db.tags, db.files, db.settings, db.noteFolds, db.syncState],
    async () => {
      await Promise.all([
        db.notes.clear(),
        db.noteTags.clear(),
        db.tags.clear(),
        db.files.clear(),
        db.settings.clear(),
        db.noteFolds.clear(),
        // Cleared here too, not just repopulated by markAllDirty below: a
        // stale row surviving from before the import could reference a note
        // or tag id that the replace just removed, and `markAllDirty` only
        // ever ADDS rows for what exists now — it never removes what no
        // longer does.
        db.syncState.clear(),
      ]);

      await Promise.all([
        db.notes.bulkAdd(notes),
        db.tags.bulkAdd(bundle.tags),
        db.files.bulkAdd(files),
        db.settings.bulkAdd(bundle.settings),
      ]);

      // `noteTags` is derived data. Trusting a file's copy of it contradicts
      // the rule that the index comes from `notes.text` and is never
      // authoritative, and it is what made a pre-M5 backup restore an empty
      // index.
      rebuiltRows = await deps.rebuildTagIndex();

      // An imported database is entirely new to the server, whatever the
      // account already holds. Marking it dirty is what makes an import
      // reach the other devices instead of sitting locally until each note
      // happens to be edited.
      await markAllDirty(db, Date.now());
    },
  );

  return {
    notes: notes.length,
    noteTags: rebuiltRows,
    tags: bundle.tags.length,
    files: files.length,
    settings: bundle.settings.length,
  };
}
