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

export interface TagMeta {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
}

export interface FileRecord {
  id: string;
  noteId: string;
  blob: Blob;
  mime: string;
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
