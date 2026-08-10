import type { NoteTag } from '@/data';

export interface TagNode {
  /** The full tag key, e.g. `work/urgent`. This is what a scope filters on. */
  tag: string;
  /** The last `/`-separated segment, for display. */
  label: string;
  /** Distinct notes carrying this tag or any descendant of it. */
  count: number;
  children: TagNode[];
}

/**
 * Counts are descendant-inclusive because selection is: clicking `work` lists
 * every `work/*` note, so showing a count that excluded them would be a lie.
 * A note carrying both `work` and `work/urgent` is counted once.
 */
export function buildTagTree(rows: ReadonlyArray<NoteTag>): TagNode[] {
  const direct = new Map<string, Set<string>>();
  for (const { tag, noteId } of rows) {
    const existing = direct.get(tag);
    if (existing === undefined) direct.set(tag, new Set([noteId]));
    else existing.add(noteId);
  }

  // A parent node exists whenever any child does, whether or not a note
  // carries the parent itself.
  const keys = new Set<string>();
  for (const tag of direct.keys()) {
    const segments = tag.split('/');
    for (let i = 1; i <= segments.length; i += 1) keys.add(segments.slice(0, i).join('/'));
  }

  const countFor = (key: string): number => {
    const seen = new Set(direct.get(key) ?? []);
    const prefix = `${key}/`;
    for (const [tag, ids] of direct) {
      if (!tag.startsWith(prefix)) continue;
      for (const id of ids) seen.add(id);
    }
    return seen.size;
  };

  const childrenOf = (parent: string | null): TagNode[] => {
    const prefix = parent === null ? '' : `${parent}/`;
    return [...keys]
      .filter((key) => {
        if (!key.startsWith(prefix)) return false;
        const rest = key.slice(prefix.length);
        return rest !== '' && !rest.includes('/');
      })
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        tag: key,
        label: key.slice(prefix.length),
        count: countFor(key),
        children: childrenOf(key),
      }));
  };

  return childrenOf(null);
}
