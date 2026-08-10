import { db } from '../db';
import { parseTags } from '../tags';
import { createFilesRepository } from './files';
import { createNotesRepository } from './notes';
import { createSettingsRepository } from './settings';
import { createTagsRepository } from './tags';

export const notes = createNotesRepository({ db, parseTags });
export const tags = createTagsRepository(db);
export const files = createFilesRepository({ db });
export const settings = createSettingsRepository(db);

export type { FilesRepository } from './files';
export type { NotesRepository, TagParser } from './notes';
export type { SettingsRepository } from './settings';
export type { TagsRepository } from './tags';
