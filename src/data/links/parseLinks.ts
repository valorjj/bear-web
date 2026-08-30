import { maskCode } from '../markdown/mask';

export interface LinkRange {
  /** Index of the first `[` in the source string. */
  start: number;
  /** Index one past the final `]`. */
  end: number;
  /** The raw title as written, before normalization. */
  raw: string;
  /** Lowercased, whitespace-collapsed, trimmed. The index key. */
  title: string;
}

/**
 * The index key for a link target.
 *
 * Case-insensitive and whitespace-collapsed so `[[Deploy Checklist]]`,
 * `[[deploy checklist]]` and `[[Deploy  Checklist]]` all name one note. This
 * is the only place a title becomes a key; `notes.linksTo` must use it too, or
 * the two sides of the join disagree and every backlink list is empty.
 */
export function normalizeTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

const LINK = /\[\[([^\]\n]*)\]\]/g;

/**
 * Every `[[…]]` outside code, with offsets into the ORIGINAL string.
 *
 * The scan runs over a MASKED copy, in which fenced and inline code has been
 * replaced character-for-character by the mask character, so its length never
 * changes and every index found in the masked copy addresses the same
 * character in the original — which is what lets the editor decorate the
 * real text.
 *
 * `[^\]\n]*` refuses to cross a newline or a `]`, so an unclosed `[[` cannot
 * swallow the rest of the note and two links on one line stay two links.
 */
export function findLinkRanges(markdown: string): LinkRange[] {
  const masked = maskCode(markdown);
  const ranges: LinkRange[] = [];

  for (const match of masked.matchAll(LINK)) {
    const raw = match[1] ?? '';
    const title = normalizeTitle(raw);
    if (title === '') continue;
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      // Read from the ORIGINAL, not the masked copy: a title is displayed and
      // stored, and the masked copy is only ever a coordinate system.
      raw: markdown.slice(match.index + 2, match.index + match[0].length - 2),
      title,
    });
  }

  return ranges;
}

export function parseLinks(markdown: string): string[] {
  return [...new Set(findLinkRanges(markdown).map((range) => range.title))];
}
