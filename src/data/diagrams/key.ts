/**
 * Bumped whenever the RENDERER's output could change for unchanged input.
 * That is a wider set than it first looks — anything on the path from
 * source text to stored SVG counts, not just the two most obvious triggers:
 *
 * - a Mermaid version bump in `server/docker/pdf/Dockerfile`
 * - an edit to `server/pdf/mermaidTheme.ts` (the theme CSS appended to
 *   every render)
 * - an edit to `server/pdf/sanitizeInPage.ts` — both its `FORBIDDEN_TAGS`
 *   removal set and its `viewBox`-derived `width`/`height` rewrite change
 *   the bytes of the SVG that gets cached, for the same source
 * - an edit to `mermaid.ts`'s `diagramId()` derivation — this is precisely
 *   the mechanism that fixed the duplicate-`id='d'` collision (the reason
 *   this constant is already `2`, not `1`); any future change to how the
 *   id is derived needs the same bump
 * - an edit to the `api.initialize(...)` config `mermaid.ts` passes before
 *   rendering (Mermaid's own render options)
 *
 * It is part of the cache key, so bumping it invalidates every cached SVG on
 * every device with no migration and no sweep. That is the entire mechanism —
 * there is deliberately nothing else that can invalidate this cache, because
 * a second mechanism would be a second thing to get wrong.
 */
export const DIAGRAM_RENDER_VERSION = 2;

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
