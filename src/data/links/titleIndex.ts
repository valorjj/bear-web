import { normalizeTitle } from './parseLinks';

/**
 * The shape both link resolution and the graph need from a note: enough to
 * match a title and break a tie, and nothing else. Structural rather than
 * `Pick<Note, …>` so `src/data/links/` need not import the entity it indexes.
 */
export interface TitledNote {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Normalized title → the note it means.
 *
 * More than one note can share a normalized title. The rule, from L2's spec
 * ("A link resolves by TITLE, and fails open"), is that the most recently
 * updated one wins and the pill says so by carrying no special state.
 *
 * This lives in `src/data/links/` rather than beside its first caller because
 * it derives an index — the same reasoning that puts `parseTags` in
 * `src/data/tags/`. Both `resolveLinkTarget` (a clicked pill) and
 * `buildGraph` (the L3 surface) go through it, so the picture the graph draws
 * cannot disagree with where a click actually lands. That agreement is
 * structural here; there is no second copy to test against.
 */
export function buildTitleIndex(index: readonly TitledNote[]): Map<string, TitledNote> {
  const byTitle = new Map<string, TitledNote>();

  for (const note of index) {
    const key = normalizeTitle(note.title);
    const current = byTitle.get(key);
    if (current === undefined || note.updatedAt > current.updatedAt) {
      byTitle.set(key, note);
    }
  }

  return byTitle;
}
