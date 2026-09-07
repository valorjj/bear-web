import { findTagRanges, normalizeTag, parseTags } from './parseTags';

/**
 * A tag name written as Markdown.
 *
 * The multi-word form is used only when the simple form could not read the
 * name back. `isBoundary` in `parseTags.ts` treats whitespace, the mask and
 * end-of-input as the only terminators of a simple tag, so whitespace is the
 * one thing that forces a closing `#`.
 */
export function tagToken(tag: string): string {
  return /\s/.test(tag) ? `#${tag}#` : `#${tag}`;
}

/**
 * Whether a name can be written and read back as itself.
 *
 * A round trip through the real parser, deliberately, rather than a list of
 * rules: the rules live in `normalizeTag` and the scanner, and a second copy
 * here would be the duplicated-grammar defect this project forbids. It also
 * catches shapes no rule list would think of — a name containing `#` cannot
 * be expressed in either form, because the simple scanner rejects a hash and
 * the multi-word form would treat it as the closer.
 */
export function canWriteTag(tag: string): boolean {
  return normalizeTag(tag) === tag && parseTags(tagToken(tag)).includes(tag);
}

/**
 * How much text a deletion takes, given the tag's own range.
 *
 * Three cases, in priority order. A line left holding nothing but whitespace
 * goes away entirely, newline included, so no blank gap is left behind — the
 * known cost is that a tag-only line sitting mid-paragraph with no blank line
 * around it joins its neighbours into one soft-wrapped paragraph, which is
 * accepted (leaving the empty line instead SPLITS that paragraph in two, so
 * neither rule is structure-preserving). Otherwise exactly ONE adjacent space
 * is absorbed, preferring the one before, so `see #a/b today` does not become
 * `see  today`.
 */
function removalRange(text: string, start: number, end: number): { from: number; to: number } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = text.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const remainder = text.slice(lineStart, start) + text.slice(end, lineEnd);
  if (remainder.trim() === '') {
    return { from: lineStart, to: nextNewline === -1 ? lineEnd : lineEnd + 1 };
  }

  const before = text[start - 1];
  if (before === ' ' || before === '\t') return { from: start - 1, to: end };

  const after = text[end];
  if (after === ' ' || after === '\t') return { from: start, to: end + 1 };

  return { from: start, to: end };
}

/**
 * Renames or deletes `from` and every descendant of it, in one note's text.
 *
 * `to === null` deletes. Both names are already-normalized tag keys.
 *
 * Matching is on the NORMALIZED NAME each range reports, never on raw text,
 * which is what makes `#a/bc` a non-match for `a/b` without a special case —
 * and reusing `findTagRanges` is what keeps tags inside code fences, URL
 * fragments and link destinations out of the rewrite for free. A string
 * replace has none of those properties.
 *
 * Ranges are rewritten RIGHT-TO-LEFT so that each splice leaves every
 * earlier offset valid.
 */
export function rewriteTag(markdown: string, from: string, to: string | null): string {
  const matches = findTagRanges(markdown).filter(
    (range) => range.tag === from || range.tag.startsWith(`${from}/`),
  );
  if (matches.length === 0) return markdown;

  let out = markdown;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const range = matches[i]!;
    if (to === null) {
      const { from: cutFrom, to: cutTo } = removalRange(out, range.start, range.end);
      out = out.slice(0, cutFrom) + out.slice(cutTo);
    } else {
      const renamed = to + range.tag.slice(from.length);
      out = out.slice(0, range.start) + tagToken(renamed) + out.slice(range.end);
    }
  }

  return out;
}
