import type { Note } from './types';

/**
 * The three orderings a user can choose. Deliberately NOT including the
 * trash's own `trashedAt` ordering: `listTrashed` keeps that, and offering it
 * as a fourth field would put a scope-specific concept in a global preference.
 */
export type NoteOrderField = 'updated' | 'created' | 'title';

export interface NoteOrder {
  field: NoteOrderField;
  /**
   * Inverts EVERY field, not only the dates — under `title` it means Z to A.
   * One boolean rather than three because that is what the single checkbox in
   * the menu controls.
   */
  newestFirst: boolean;
}

export const DEFAULT_NOTE_ORDER: NoteOrder = { field: 'updated', newestFirst: true };

const FIELDS: readonly NoteOrderField[] = ['updated', 'created', 'title'];

/**
 * A total order, so `Array.prototype.sort` is deterministic across engines: a
 * comparator returning 0 for distinct notes leaves their relative order up to
 * the implementation, and the list would reshuffle on unrelated re-renders.
 * `id` is the tiebreaker because it is the only field guaranteed unique.
 */
export function compareNotes(order: NoteOrder): (a: Note, b: Note) => number {
  const direction = order.newestFirst ? -1 : 1;

  return (a, b) => {
    let primary: number;

    switch (order.field) {
      case 'updated':
        primary = a.updatedAt - b.updatedAt;
        break;
      case 'created':
        primary = a.createdAt - b.createdAt;
        break;
      case 'title':
        // localeCompare, never `<`: the corpus is Korean and codepoint order
        // on Hangul is not alphabetical order. `undefined` locale follows the
        // runtime's, which is the same locale the row's title is read in.
        primary = a.title.localeCompare(b.title, undefined, { numeric: true });
        break;
    }

    if (primary !== 0) return primary * direction;
    return a.id.localeCompare(b.id);
  };
}

/**
 * Validates a value read back from the `settings` table. A hand-edited row, or
 * one written by a future version with a field this build does not know, must
 * fall back to the default rather than reach `compareNotes` as an unhandled
 * `switch` arm.
 */
export function isNoteOrder(value: unknown): value is NoteOrder {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<NoteOrder>;
  return (
    typeof candidate.newestFirst === 'boolean' &&
    typeof candidate.field === 'string' &&
    FIELDS.includes(candidate.field as NoteOrderField)
  );
}
