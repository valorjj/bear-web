/**
 * The Markdown reference for a stored image: `files/<id>.webp`.
 *
 * Lives in `src/data/`, NOT `src/features/`, for the same reason `parseTags`
 * does: the data layer needs it — the reclamation sweep in `notes.save` reads
 * a note's referenced ids — and `src/data/` must not import from
 * `src/features/`. Putting it under the editor would also make
 * `features/editor` import `features/notes`, which already imports
 * `features/editor`.
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

/**
 * The widest an image may be asked to display at.
 *
 * The stored WebP is at most 2048px on its long edge (K1), so a display width
 * beyond that only stretches pixels. It is also the clamp that stops a note
 * edited by hand — or synced from a client with a bug — rendering a 999999px
 * image whose cause the user cannot see.
 */
export const MAX_DISPLAY_WIDTH = 2048;

export interface ImageAlt {
  alt: string;
  width: number | null;
}

/**
 * Splits Obsidian's `alt|640` convention into its parts.
 *
 * The width rides in the ALT TEXT rather than in a separate field so it
 * travels with the note: sync carries it, an exported bundle carries it, and
 * another device lays the note out the same way. It is also per-USE, so one
 * screenshot can be full width in one note and a thumbnail in another.
 *
 * The cost, accepted deliberately: this is not standard Markdown, and a strict
 * reader shows `alt|640` as the alt text. That is a wart in one place —
 * someone else's viewer — against correct behaviour in this app and in
 * Obsidian, which is the reader that actually opens the bundles this app
 * produces.
 *
 * A NON-NUMERIC suffix stays part of the alt text rather than being treated as
 * a malformed width. `a|b` is what every other reader will display, and
 * guessing otherwise would silently swallow a character the user typed.
 */
export function parseImageAlt(raw: string): ImageAlt {
  const pipe = raw.lastIndexOf('|');
  if (pipe === -1) return { alt: raw, width: null };

  const suffix = raw.slice(pipe + 1);
  if (!/^[0-9]+$/.test(suffix)) return { alt: raw, width: null };

  const value = Number(suffix);
  if (value < 1) return { alt: raw, width: null };

  return { alt: raw.slice(0, pipe), width: Math.min(value, MAX_DISPLAY_WIDTH) };
}

/**
 * The inverse. The pipe is OMITTED entirely when there is no width, so an
 * image nobody resized serialises byte-identically to what K1 wrote — which
 * the `CANONICAL` round-trip fixtures pin.
 */
export function formatImageAlt(alt: string, width: number | null): string {
  return width === null ? alt : `${alt}|${width}`;
}
