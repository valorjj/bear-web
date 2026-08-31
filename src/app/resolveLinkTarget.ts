import { buildTitleIndex, type Note } from '@/data';

/**
 * The note a `[[link]]` pill's normalized title resolves to, or `null` when
 * nothing matches.
 *
 * The tie-breaking rule itself now lives in `src/data/links/titleIndex.ts`,
 * shared with L3's graph so the picture and the click cannot disagree. This
 * stays as the app-level name for "resolve one pill", and still does not
 * re-normalize `normalizedTitle` — a caller passing a raw title matches
 * nothing, exactly as before.
 */
export function resolveLinkTarget(
  noteIndex: readonly Pick<Note, 'id' | 'title' | 'updatedAt'>[],
  normalizedTitle: string,
): Pick<Note, 'id' | 'title' | 'updatedAt'> | null {
  return buildTitleIndex(noteIndex).get(normalizedTitle) ?? null;
}
