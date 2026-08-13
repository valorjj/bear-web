import { hasQuery, normalizeForSearch } from './search';

/**
 * The one-line preview shown beneath a note's title in the list: the first
 * non-empty line *after* the one `deriveTitle` consumed.
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
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const ordinarySnippet = (): string => lines[1] ?? '';

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
