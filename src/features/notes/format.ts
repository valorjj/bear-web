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
 * Markdown syntax is left intact. This previews the raw text the user typed.
 */
export function deriveSnippet(text: string, query?: string): string {
  const lines = text.split('\n');

  if (query !== undefined && hasQuery(query)) {
    const target = normalizeForSearch(query.trim());
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (normalizeForSearch(trimmed).includes(target)) return trimmed;
    }
    // Nothing matched this line-by-line — fall through to the ordinary
    // snippet rather than returning nothing.
  }

  let seenTitle = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!seenTitle) {
      seenTitle = true;
      continue;
    }
    return trimmed;
  }

  return '';
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
