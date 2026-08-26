import { hasQuery, normalizeForSearch } from './search';

/**
 * How much joined body text a snippet may carry.
 *
 * The row clamps to at most two lines of `text-ui-sm`, so anything past a
 * couple of hundred characters is cropped by CSS and never seen. The cap is
 * here rather than left to the clamp because the string also feeds the row's
 * `aria-label`, where nothing crops it and a screen reader would read the
 * whole note aloud.
 */
const SNIPPET_MAX_CHARS = 240;

/**
 * Markdown image syntax, removed from a preview because the row draws the
 * image itself (see `thumbnail.ts`). Without this, a note that opens with a
 * picture previews as `![](https://…)` — the URL, in place of the words the
 * user actually wrote.
 *
 * Deliberately looser than `thumbnail.ts`'s pattern: this one only has to
 * delete text, so matching an image whose URL that stricter pattern rejects
 * costs nothing, while missing one leaves a URL in the preview.
 */
const IMAGE_SYNTAX = /!\[[^\]]*\]\([^)]*\)/g;

/**
 * The preview shown beneath a note's title in the list: the body text that
 * follows the line `deriveTitle` consumed, with its blank lines closed up and
 * its remaining lines joined into one run of prose.
 *
 * Joined rather than "the first body line alone", which is what this returned
 * until the M9c row redesign: the row reserves two clamped lines at the
 * default density, and a single short body line filled exactly one of them, so
 * half the reserved height was blank for most notes. Joining lets the preview
 * fill the space it already occupies.
 *
 * With a `query`, it is instead the first line containing that query —
 * including the title line, which the no-query path deliberately skips. A
 * snippet that does not contain the match would render with nothing
 * highlighted, which reads as a false positive.
 *
 * The one exception: when the title line is the ONLY line that matches, this
 * still skips it, exactly like the no-query path. The title already renders
 * (highlighted) above the snippet, so repeating it here as the snippet would
 * print the same text twice with its raw `#` syntax exposed, and highlight
 * nothing new. When a body line also matches, the title-line match still
 * wins, as before — this exception only fires when the title is the sole
 * match.
 *
 * Markdown syntax is left intact. This previews the raw text the user typed.
 */
export function deriveSnippet(text: string, query?: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.replace(IMAGE_SYNTAX, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');

  const ordinarySnippet = (): string => {
    const body = lines.slice(1).join(' ');
    return body.length > SNIPPET_MAX_CHARS ? body.slice(0, SNIPPET_MAX_CHARS).trimEnd() : body;
  };

  if (query !== undefined && hasQuery(query)) {
    const target = normalizeForSearch(query.trim());
    const matches = (line: string): boolean => normalizeForSearch(line).includes(target);

    const titleLine = lines[0];
    if (titleLine !== undefined && matches(titleLine)) {
      const bodyMatch = lines.slice(1).find(matches);
      return bodyMatch !== undefined ? titleLine : ordinarySnippet();
    }

    const match = lines.find(matches);
    if (match !== undefined) return match;
    // Nothing matched this line-by-line — fall through to the ordinary
    // snippet rather than returning nothing.
  }

  return ordinarySnippet();
}

/**
 * `hourCycle: 'h23'` rather than `hour12: false`: the latter renders midnight
 * as 24:00 under some ICU builds.
 */
export function formatNoteDate(timestamp: number, locale: string, now: number): string {
  const when = new Date(timestamp);
  const today = new Date(now);

  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();

  return sameDay
    ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(when)
    : new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(when);
}
