export interface Note {
  /** Stable UUID. Exists so sync can be added later without a data migration. */
  id: string;
  /** Derived cache of the first non-empty line of `text`. Never edited directly. */
  title: string;
  /** Markdown. The canonical content of the note. */
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Not indexed — IndexedDB rejects boolean keys. Filter in memory. */
  pinned: boolean;
  /** Indexed. The index contains only trashed notes, because IndexedDB omits nulls. */
  trashedAt: number | null;
  /** Reserved for Phase 2. Stays null throughout Phase 1. */
  archivedAt: number | null;
}

export interface NoteTag {
  noteId: string;
  tag: string;
}

export interface NoteLink {
  noteId: string;
  /** Normalized target title — `normalizeTitle`'s output. */
  toTitle: string;
}

export interface TagMeta {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
}

/**
 * Which sections of a note are folded, as `serializeFoldKey` strings.
 *
 * View state, not content: deliberately absent from the backup bundle, because
 * a restore should return the user's notes and not their reading position.
 */
export interface NoteFolds {
  noteId: string;
  keys: string[];
}

export interface FileRecord {
  id: string;
  noteId: string;
  blob: Blob;
  mime: string;
  /**
   * The stored image's dimensions, after downscaling.
   *
   * Held on the record so a node view can reserve the right box BEFORE the
   * blob resolves out of IndexedDB — without them the text reflows the moment
   * each image lands, which on a long note is every image in turn.
   */
  width: number;
  height: number;
  /**
   * `blob.size`, denormalised. Lets K2's quota check sum an account's usage
   * without reading a single blob out of the database.
   */
  bytes: number;
  createdAt: number;
}

/**
 * One rendered diagram, cached.
 *
 * DERIVED DATA. It is never synced, never in `BackupBundle`, and safe to
 * delete at any moment: the source is in the note's own text, which does
 * sync, so a missing entry costs one render. `hash` is
 * `diagramKey(source)` — content plus render version.
 */
export interface DiagramRecord {
  hash: string;
  svg: string;
  /** Derived from `svg`, never supplied: one source of truth for one fact. */
  bytes: number;
  lastUsed: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

/** A file with its blob encoded as base64, so the bundle is JSON-safe. */
export interface SerializedFile {
  id: string;
  noteId: string;
  mime: string;
  /** base64, without a data-URL prefix. */
  data: string;
  /**
   * OPTIONAL, because a backup written before K1 has none. A restore supplies
   * `0` for a missing dimension rather than guessing, and the node view reads
   * `0` as "unknown ratio" — the same value it would see for a record written
   * before image metadata existed.
   */
  width?: number;
  height?: number;
  createdAt?: number;
}

/**
 * `'image'` rows carry no revision and are never pulled: an image is
 * immutable, so its bookkeeping only ever answers "has this been uploaded".
 */
export type SyncKind = 'note' | 'tag' | 'image';

/**
 * Per-row sync bookkeeping.
 *
 * Deliberately NOT fields on `Note`: `Note` is the shape `BackupBundle`
 * serialises, so sync state added to it would leak server bookkeeping into
 * every exported backup and every import would carry another account's
 * revision numbers.
 *
 * Keyed by `[kind, key]` rather than by note id, because tag metadata syncs
 * too and a second bookkeeping table would mean a second engine.
 */
export interface SyncState {
  kind: SyncKind;
  /** A note id when `kind` is `'note'`; the tag string when `'tag'`. */
  key: string;
  /** The server revision this row was last confirmed at. 0 means never synced. */
  syncedRev: number;
  /** `0 | 1`, not boolean: this is indexed, and IndexedDB rejects boolean keys. */
  dirty: 0 | 1;
  /**
   * `0 | 1`. Set when the local row is purged, and the reason this table
   * outlives the note: once the note is gone there is nothing else left to
   * tell the server to write a tombstone.
   */
  deleted: 0 | 1;
  /**
   * The note's `updatedAt` at the moment `dirty` was last set.
   *
   * Push carries it and the accept path clears `dirty` only if the stored note
   * still matches — so an edit that lands while a push is in flight leaves the
   * row dirty and re-pushes, instead of being silently stranded on one device.
   */
  markedAt: number;
}

export interface BackupBundle {
  format: 'bear-web-backup';
  schemaVersion: number;
  exportedAt: number;
  notes: Note[];
  noteTags: NoteTag[];
  tags: TagMeta[];
  files: SerializedFile[];
  settings: SettingRecord[];
}
