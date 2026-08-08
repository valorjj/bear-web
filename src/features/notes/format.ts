/**
 * The one-line preview shown beneath a note's title in the list: the first
 * non-empty line *after* the one `deriveTitle` consumed.
 *
 * Markdown syntax is left intact. This previews the raw text the user typed;
 * only the title line is stripped, and only by `deriveTitle`.
 */
export function deriveSnippet(text: string): string {
  const lines = text.split('\n');
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
