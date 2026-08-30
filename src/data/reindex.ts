import type { BearDatabase } from './db';
import { normalizeTitle } from './links';

/**
 * Replaces one note's derived `noteTags` and `noteLinks` rows to match its
 * current text.
 *
 * Shared by `notes.ts` (create/save/restore) and, from D2, the sync engine's
 * apply path, so that a note's tag and link rows can only ever be produced by
 * ONE piece of logic. The tag index has already disagreed with its own
 * rebuild once in this project's history — a second, independently maintained
 * copy of "how tags (or links) get derived from text" is exactly how that
 * regresses again. This module exists so the rebuild path stays the single
 * authority, not one of two or three that must be kept in sync by hand.
 *
 * `noteTitle`, when given, is the note's OWN title, so a link the note makes
 * to itself can be dropped from its outgoing rows: a self-link is noise in a
 * backlinks list, never information about another note.
 */
export async function reindexNote(
  db: BearDatabase,
  noteId: string,
  text: string,
  parseTags: (markdown: string) => string[],
  parseLinks: (markdown: string) => string[],
  noteTitle?: string,
): Promise<void> {
  const tags = [...new Set(parseTags(text))];
  const ownTitle = noteTitle !== undefined ? normalizeTitle(noteTitle) : undefined;
  const links = [...new Set(parseLinks(text))].filter((title) => title !== ownTitle);

  await db.noteTags.where('noteId').equals(noteId).delete();
  if (tags.length > 0) {
    await db.noteTags.bulkPut(tags.map((tag) => ({ noteId, tag })));
  }

  await db.noteLinks.where('noteId').equals(noteId).delete();
  if (links.length > 0) {
    await db.noteLinks.bulkPut(links.map((toTitle) => ({ noteId, toTitle })));
  }
}
