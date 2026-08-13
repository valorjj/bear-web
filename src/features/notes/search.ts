import type { Note } from '@/data';

/** A half-open `[start, end)` range of the NFC-normalized text. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * The comparison form for both a query and a note's text.
 *
 * NFC first, because Hangul has two Unicode representations that are not
 * `===`-equal: a note imported from a macOS-authored file can be decomposed
 * while a query typed in the browser is composed, which would make the note
 * unfindable by its own contents.
 */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/** Whether a query is worth filtering by at all. */
export function hasQuery(query: string): boolean {
  return query.trim() !== '';
}

/**
 * Every occurrence of `query` in `text`, as indices into
 * `text.normalize('NFC')` — NOT into `text` itself. NFC can change a string's
 * length, so a caller that wants to highlight these ranges must render the
 * normalized string too.
 *
 * Matching is `indexOf` in a loop rather than a `RegExp`, which makes regex
 * metacharacters literal with no escaping step to get wrong.
 */
export function findMatchRanges(text: string, query: string): MatchRange[] {
  const needle = query.trim();
  if (needle === '') return [];

  const source = text.normalize('NFC');
  const haystack = source.toLowerCase();

  // `.toLowerCase()` can change length ('İ' folds to two code units), which
  // would shift every index after it. Losing the highlight is acceptable;
  // marking the wrong characters is not.
  if (haystack.length !== source.length) return [];

  const target = normalizeForSearch(needle);
  if (target === '') return [];

  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(target, from);
    if (start === -1) return ranges;
    ranges.push({ start, end: start + target.length });
    from = start + target.length;
  }
}

/**
 * The notes matching `query`, in the order given.
 *
 * `undefined` passes through untouched: `useNotes` uses it for "the live query
 * has not resolved yet", and collapsing that to an empty array would render
 * "no matches" during the first frame of every load.
 */
export function filterByQuery(notes: Note[] | undefined, query: string): Note[] | undefined {
  if (notes === undefined) return undefined;
  if (!hasQuery(query)) return notes;

  const target = normalizeForSearch(query.trim());
  return notes.filter((note) => normalizeForSearch(note.text).includes(target));
}
