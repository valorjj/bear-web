import type { Note } from '@/data';

import type { SmartListId } from './scope';

export interface PredicateContext {
  /**
   * Note ids carrying at least one tag, taken from the derived `noteTags`
   * index — never from a parser. Feature code reaches the index only through
   * `notes.allTagRows()`, and `src/features/` must not import the parser from
   * `src/data/tags/`. The index also reflects active notes only, consistently
   * across trash, restore and rebuild, which is what makes it safe here.
   */
  tagged: ReadonlySet<string>;
  /** Injected so `today` is testable without touching the system clock. */
  now: number;
}

export type SmartListPredicate = (note: Note, ctx: PredicateContext) => boolean;

/**
 * An unchecked task at the start of a line, allowing leading whitespace for
 * nesting.
 *
 * Deliberately NOT `/g`: a global regex carries `lastIndex` between `.test()`
 * calls, so a module-level constant reused per note would alternate true and
 * false on identical input and drop roughly half the matching notes.
 *
 * `[-*+]` rather than just `-` because `importDatabase` accepts arbitrary
 * Markdown and a note is only canonical once it has been through the editor.
 * Our serializer emits `- [ ]`, normalising `* [ ]` to it — but an imported,
 * never-opened note keeps whatever it was written with, and a checkbox the
 * user can see must not be invisible to this list.
 *
 * A checked task cannot match: `\[ \]` requires a literal space, so both
 * `[x]` and `[X]` fail regardless of case.
 *
 * **Known false positive, accepted:** an unchecked task inside a fenced code
 * block counts. Masking code spans is `parseTags`' job and lives in the data
 * layer; duplicating it here for one smart list is not worth a second copy of
 * that logic. Same reasoning as the deliberately-unmasked indented code blocks
 * recorded in CLAUDE.md.
 */
export const UNCHECKED_TASK = /^[ \t]*[-*+] \[ \]/m;

/** Whether two instants fall on the same date in the viewer's local zone. */
export function isSameLocalDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * One predicate per smart list. `all` and `trash` accept everything because the
 * scope query has already selected the right set; they exist so the table is
 * total over `SmartListId` and callers never need a special case.
 *
 * `locked` accepts nothing, permanently. Real encryption needs WebCrypto, a
 * passphrase flow and a recovery story, and is Phase 2.
 */
export const SMART_LIST_PREDICATES: Record<SmartListId, SmartListPredicate> = {
  all: () => true,
  untagged: (note, ctx) => !ctx.tagged.has(note.id),
  todo: (note) => UNCHECKED_TASK.test(note.text),
  today: (note, ctx) => isSameLocalDay(note.updatedAt, ctx.now),
  pinned: (note) => note.pinned,
  locked: () => false,
  trash: () => true,
};
