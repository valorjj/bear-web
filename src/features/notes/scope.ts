import { notes } from '@/data';
import type { Note, NotesRepository } from '@/data';

/**
 * Which set of notes the list is showing. M3 has exactly two; M6 replaces this
 * union with the smart-list registry.
 */
export type NoteScope = 'active' | 'trashed';

/** Narrowed for injection in tests. */
export type ScopeLister = Pick<NotesRepository, 'listActive' | 'listTrashed'>;

/**
 * Ordering comes from the repository and is not re-sorted here: `listActive`
 * returns most recently updated first, `listTrashed` most recently deleted
 * first.
 */
export function listForScope(scope: NoteScope, repository: ScopeLister = notes): Promise<Note[]> {
  return scope === 'active' ? repository.listActive() : repository.listTrashed();
}
