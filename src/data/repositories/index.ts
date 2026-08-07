import { db } from '../db';
import { createFilesRepository } from './files';
import { createNotesRepository, type TagParser } from './notes';
import { createSettingsRepository } from './settings';
import { createTagsRepository } from './tags';

/**
 * Placeholder until M5 delivers the real parser.
 *
 * `parseTags` is one of the two functions where a wrong implementation corrupts
 * user data, so the spec makes test-driven development mandatory for it. Rather
 * than ship an untested approximation here, M1 wires in a parser that finds
 * nothing and leaves the index-maintenance logic fully exercised by injected
 * fakes in the repository tests.
 *
 * M5 replaces this single line.
 */
const noTags: TagParser = () => [];

export const notes = createNotesRepository({ db, parseTags: noTags });
export const tags = createTagsRepository(db);
export const files = createFilesRepository({ db });
export const settings = createSettingsRepository(db);

export type { FilesRepository } from './files';
export type { NotesRepository, TagParser } from './notes';
export type { SettingsRepository } from './settings';
export type { TagsRepository } from './tags';
