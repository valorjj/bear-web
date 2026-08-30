import { normalizeTitle, type Note } from '@/data';

/**
 * The note a `[[link]]` pill's normalized title resolves to, or `null` when
 * nothing matches. A pure function, extracted out of `handleActivateLink` so
 * the resolution logic — the only piece of Task 4 with real branching — can
 * be tested directly rather than through a rendered `AppShell`.
 *
 * `title` must already be normalized (`LinkPill` reports it that way); this
 * does not re-normalize it, only each candidate note's own title, so a caller
 * passing a raw, un-normalized title would simply match nothing.
 *
 * More than one note can share a normalized title. Per the spec
 * ("A link resolves by TITLE, and fails open"): "Where two notes share a
 * title, the most recently updated one wins, and the pill says so by
 * carrying no special state." So this keeps the candidate with the highest
 * `updatedAt` across every match, not the first one encountered — first-match
 * would happen to give the right answer whenever the winner is also first in
 * `noteIndex`'s own order, which is exactly the case a shallow test would
 * miss.
 */
export function resolveLinkTarget(
  noteIndex: readonly Pick<Note, 'id' | 'title' | 'updatedAt'>[],
  normalizedTitle: string,
): Pick<Note, 'id' | 'title' | 'updatedAt'> | null {
  let target: Pick<Note, 'id' | 'title' | 'updatedAt'> | null = null;
  for (const note of noteIndex) {
    if (normalizeTitle(note.title) !== normalizedTitle) continue;
    if (target === null || note.updatedAt > target.updatedAt) target = note;
  }
  return target;
}
