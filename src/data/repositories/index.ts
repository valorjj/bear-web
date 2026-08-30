import { db } from '../db';
import { parseLinks } from '../links';
import { parseTags } from '../tags';
import { createFilesRepository } from './files';
import { createFoldsRepository } from './folds';
import { createNotesRepository } from './notes';
import { createSettingsRepository } from './settings';
import { createTagsRepository } from './tags';

export const notes = createNotesRepository({ db, parseTags, parseLinks });
export const tags = createTagsRepository(db);
export const files = createFilesRepository({ db });
export const settings = createSettingsRepository(db);
export const folds = createFoldsRepository(db);

export type { FilesRepository } from './files';
export type { FoldsRepository } from './folds';
export type { LinkParser, NotesRepository, TagParser } from './notes';
export type { SettingsRepository } from './settings';
export type { TagsRepository } from './tags';
