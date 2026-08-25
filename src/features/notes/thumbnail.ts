/**
 * The image a note-list row shows beside its preview.
 *
 * This app stores no images — `RawImage` (see `src/features/editor/RawBlock.ts`)
 * deliberately renders `![alt](url)` as its own muted monospace SOURCE rather
 * than as a picture, and image storage is unscheduled. The only images a note
 * can therefore refer to are ones already on the network, so a row thumbnail
 * can come from exactly one place: the first remote image URL written in the
 * note's Markdown.
 *
 * KNOWN INCONSISTENCY, accepted deliberately: the list shows a picture the
 * editor shows as text. The alternative was a thumbnail region reserved in
 * every row with nothing to put in it until image storage ships.
 */

/**
 * Schemes a thumbnail may load from.
 *
 * `http:` is excluded, not overlooked — the app is served over HTTPS from
 * GitHub Pages, so a plaintext image is blocked as mixed content and would
 * render as a broken box on every row that named one. `data:` is admitted only
 * for an image media type: a `data:text/html` destination in an `<img src>` is
 * inert in every current browser, but admitting a scripting media type here
 * because today's browsers happen to ignore it is not a bet worth taking.
 */
function isDisplayable(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return /^data:image\/[a-z0-9.+-]+[,;]/i.test(url);
}

/** A backtick or tilde fence opener, per CommonMark: up to 3 spaces, 3+ markers. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * `![alt](destination)`, with the two destination forms CommonMark allows: a
 * bare run of non-space characters, or anything at all inside angle brackets.
 * The optional trailing title is matched so it can be discarded — without it,
 * `![a](url "t")` would yield `url "t")` and never load.
 *
 * The alt text is matched as "anything but a bracket", so a nested `[]` pair
 * simply fails to match rather than matching wrongly. That is the correct
 * failure: a note with a bracketed alt gets no thumbnail, not a thumbnail of
 * the wrong URL.
 */
const IMAGE = /!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/**
 * The first displayable image URL in a note, or `null`.
 *
 * Fenced code blocks are skipped — their contents are not Markdown, so a note
 * documenting the image syntax must not sprout a thumbnail of the URL its
 * example happens to name. Inline code spans are NOT skipped; that would want
 * the tag parser's masking machinery, and a `` `![a](url)` `` written inline is
 * rare enough to accept as a false positive rather than reach across a
 * boundary for.
 */
export function firstImageUrl(text: string): string | null {
  let fence: string | null = null;

  for (const line of text.split('\n')) {
    if (fence !== null) {
      // A closer is the same character, at least as long, and alone on its
      // line — matching `parseTags`' reading of the same CommonMark rule.
      const closer = FENCE.exec(line);
      if (closer !== null && closer[1][0] === fence[0] && closer[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const opener = FENCE.exec(line);
    if (opener !== null) {
      fence = opener[1];
      continue;
    }

    IMAGE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMAGE.exec(line)) !== null) {
      const url = match[1] ?? match[2];
      // Keep looking rather than giving up on the line: a note whose first
      // image is an unreachable `http:` one still deserves the thumbnail of
      // its second.
      if (url !== undefined && isDisplayable(url)) return url;
    }
  }

  return null;
}
