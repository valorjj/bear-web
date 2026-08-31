/**
 * Bumped whenever the RENDERER's output could change for unchanged input: a
 * Mermaid version bump in `server/docker/pdf/Dockerfile`, or an edit to
 * `server/pdf/mermaidTheme.ts`.
 *
 * It is part of the cache key, so bumping it invalidates every cached SVG on
 * every device with no migration and no sweep. That is the entire mechanism —
 * there is deliberately nothing else that can invalidate this cache, because
 * a second mechanism would be a second thing to get wrong.
 */
export const DIAGRAM_RENDER_VERSION = 1;

/**
 * The cache key for one diagram source.
 *
 * Content-addressed, so an unchanged diagram never re-renders, an edited one
 * renders once, and a note arriving by sync renders once on the second
 * device. `crypto.subtle` rather than a hashing dependency: the ceiling is
 * frozen and this costs nothing.
 */
export async function diagramKey(source: string): Promise<string> {
  const encoded = new TextEncoder().encode(`${DIAGRAM_RENDER_VERSION}\n${source}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
