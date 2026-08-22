import type { BearDatabase } from './db';

/**
 * Replaces one note's derived `noteTags` rows to match its current text.
 *
 * Shared by `notes.ts` (create/save/restore) and, from D2, the sync engine's
 * apply path, so that a note's tag rows can only ever be produced by ONE
 * piece of logic. The tag index has already disagreed with its own rebuild
 * once in this project's history — a second, independently maintained copy
 * of "how tags get derived from text" is exactly how that regresses again.
 * This module exists so the rebuild path stays the single authority, not one
 * of two or three that must be kept in sync by hand.
 */
export async function reindexNote(
  db: BearDatabase,
  noteId: string,
  text: string,
  parseTags: (markdown: string) => string[],
): Promise<void> {
  const tags = [...new Set(parseTags(text))];

  await db.noteTags.where('noteId').equals(noteId).delete();
  if (tags.length > 0) {
    await db.noteTags.bulkPut(tags.map((tag) => ({ noteId, tag })));
  }
}
