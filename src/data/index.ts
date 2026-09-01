export { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, exportDatabase, importDatabase } from './backup';
export type { ImportDeps, ImportResult } from './backup';
export { BearDatabase, DATABASE_NAME, db } from './db';
export { deriveTitle } from './derive';
export { DIAGRAM_RENDER_VERSION, diagramKey } from './diagrams';
export {
  formatImageAlt,
  loadImageBlob,
  MAX_DISPLAY_WIDTH,
  parseImageAlt,
  storedImageId,
  storedImageIds,
  storedImagePath,
} from './images';
export { hasSignedInBefore, SESSION_HINT_KEY } from './sync/config';
export { newId } from './ids';
export { compareNotes, DEFAULT_NOTE_ORDER, isNoteOrder, NOTE_ORDER_FIELDS } from './order';
export type { NoteOrder, NoteOrderField } from './order';
export {
  LINK_INDEX_VERSION,
  LINK_INDEX_VERSION_KEY,
  runLinkMigrations,
  runMigrations,
  runStartupLinkMigrations,
  runStartupMigrations,
  TAG_INDEX_VERSION,
  TAG_INDEX_VERSION_KEY,
} from './migrations';
export type { LinkMigrationDeps, MigrationDeps } from './migrations';
export { openDatabase, resolveDatabase } from './open';
export { persistStorage, requestPersistentStorage } from './persist';
export type { PersistDeps, PersistOutcome } from './persist';
export { reindexNote } from './reindex';
export { runStartupFileSweep, runStartupSweep, sweepBlankNotes, sweepOrphanFiles } from './sweep';
export type { FileSweepDeps, SweepDeps } from './sweep';
export { API_ORIGIN } from './sync/config';
export { createEngine, LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from './sync/engine';
export type { EngineDeps, SyncOutcome } from './sync/engine';
export { markAllDirty, markDeleted, markDirty } from './sync/markDirty';
export {
  createTransport,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from './sync/transport';
export type {
  PullResponse,
  PushNote,
  PushResponse,
  PushTag,
  RemoteNote,
  RemoteTag,
  Transport,
} from './sync/transport';
export { findTagRanges, parseTags } from './tags';
export type { TagRange } from './tags';
export { buildTitleIndex, findLinkRanges, normalizeTitle, parseLinks } from './links';
export type { LinkRange, TitledNote } from './links';
export type { DatabaseStatus, ResolveDatabaseDeps } from './open';
/**
 * `createDiagramsRepository` is the only repository FACTORY exported from
 * this barrel — every sibling here (`notes`, `tags`, `files`, `settings`,
 * `folds`) exposes only its singleton instance and its interface type. It is
 * exported for exactly one reason: `ensureDiagram`'s `now` override needs a
 * repository whose CLOCK differs from the shared singleton's, and `put`/
 * `touch` fix their clock at construction, not per call — so a test-only
 * clock override means building a second repository over the same `db`
 * rather than duplicating the LRU/eviction logic here. This precedent is
 * deliberate, not a template: a new repository should still follow the
 * singleton-plus-interface pattern unless it has this same need.
 */
export {
  createDiagramsRepository,
  DIAGRAM_CACHE_MAX_BYTES,
  diagrams,
  files,
  folds,
  notes,
  settings,
  tags,
} from './repositories';
export type {
  DiagramsRepository,
  DiagramsRepositoryDeps,
  FilesRepository,
  FoldsRepository,
  LinkParser,
  NotesRepository,
  SettingsRepository,
  TagParser,
  TagsRepository,
} from './repositories';
export type {
  BackupBundle,
  DiagramRecord,
  FileRecord,
  Note,
  NoteFolds,
  NoteLink,
  NoteTag,
  SerializedFile,
  SettingRecord,
  SyncKind,
  SyncState,
  TagMeta,
} from './types';
