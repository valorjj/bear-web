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

  // Descendant-inclusive note-id sets, accumulated bottom-up in one pass
  // instead of a prefix scan of the whole tag set per node (which made this
  // O(T^2) on the tag count: 500 tags -> 8ms, 2000 -> 69ms, 5000 -> 321ms —
  // measured with a realistic mostly-flat set of tags, where a per-node prefix
  // scan degrades worst). `directChildrenOf` is built once, so each key is
  // visited only when its own direct parent is processed — O(T) total, not
  // O(T^2) — and merges only its direct children's already-accumulated sets,
  // never rescanning the whole tag set.
  const directChildrenOf = new Map<string, string[]>();
  for (const key of keys) {
    const lastSlash = key.lastIndexOf('/');
    if (lastSlash === -1) continue;
    const parent = key.slice(0, lastSlash);
    const siblings = directChildrenOf.get(parent);
    if (siblings === undefined) directChildrenOf.set(parent, [key]);
    else siblings.push(key);
  }

  const idsFor = new Map<string, Set<string>>();
  const byDepthDescending = [...keys].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const key of byDepthDescending) {
    const seen = new Set(direct.get(key) ?? []);
    for (const child of directChildrenOf.get(key) ?? []) {
      // The child was already processed: it has strictly more segments than
      // `key`, and byDepthDescending visits deeper keys first.
      for (const id of idsFor.get(child) ?? []) seen.add(id);
    }
    idsFor.set(key, seen);
  }

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
        count: idsFor.get(key)?.size ?? 0,
        children: childrenOf(key),
      }));
  };

  return childrenOf(null);
}

/**
 * Whether `tag` appears anywhere in `nodes`, at any depth.
 *
 * Shared by `AppShell`'s vanished-tag effect and its tag-activation guard —
 * both need "does the sidebar know this tag" and must agree by construction,
 * not by two hand-written walks staying in sync.
 */
export function hasTag(nodes: TagNode[], tag: string): boolean {
  return nodes.some((node) => node.tag === tag || hasTag(node.children, tag));
}
