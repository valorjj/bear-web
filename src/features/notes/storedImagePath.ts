/**
 * The Markdown reference for a stored image: `files/<id>.webp`.
 *
 * A relative path rather than a `bear://` scheme or an absolute URL, and the
 * choice is IRREVERSIBLE — it cannot change without rewriting every note that
 * has an image. Two properties pay for it. Sync moves note text verbatim, so a
 * device-independent path needs no rewriting on the way in or out. And a note
 * exported beside a `files/` directory is a Markdown bundle that opens in
 * Obsidian or any other editor, with no app-specific syntax to strip.
 *
 * Anchored at both ends, so `https://x.example/files/abc.webp` does NOT match:
 * a remote URL that happens to contain the shape must keep rendering as
 * monospace source, which is the privacy property K1 preserves deliberately.
 * The id character class excludes `.` and `/`, so a traversal cannot match
 * either.
 */
const PATTERN = /^files\/([A-Za-z0-9_-]+)\.webp$/;

export function storedImagePath(id: string): string {
  return `files/${id}.webp`;
}

/** The id in a stored-image path, or `null` for anything else — a remote URL included. */
export function storedImageId(path: string): string | null {
  return PATTERN.exec(path)?.[1] ?? null;
}

/**
 * Every stored-image id a note references, in document order, deduplicated.
 *
 * Deduplicated because the only caller is the reclamation sweep, which asks
 * "is this file still referenced at all" — one image used twice is referenced
 * once as far as that question goes.
 */
export function storedImageIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const id = storedImageId(match[1]);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
