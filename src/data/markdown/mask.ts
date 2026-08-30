/**
 * The code masker shared by tag parsing and link parsing.
 *
 * Lives here, outside `src/data/tags/`, because both `parseTags` and
 * `parseLinks` need to agree on exactly what counts as code: a second copy of
 * these fence rules is the duplicated grammar this project forbids. See
 * `docs/rulings/tag-grammar.md` for the rulings this file's fence handling is
 * governed by.
 */

/**
 * Stands in for a masked character. Deliberately not a space: a space before a
 * `#` would satisfy the start rule and turn `` `x`#work `` into a tag.
 * Terminates a tag, but never permits one to start.
 *
 * Must be typed as the four-character escape sequence shown below, never
 * pasted as a literal NUL byte — a raw NUL byte looks identical in most
 * editors but silently breaks plain-text tools like `grep` run against this
 * file.
 */
export const MASK = '\u0000';

/**
 * A backtick fence's info string may not itself contain a backtick (per
 * CommonMark); a line that merely starts with an inline code span, like
 * `` ```code``` is inline ``, is a paragraph, not a fence opener.
 */
const BACKTICK_OPENER = /^ {0,3}(`{3,})([^`]*)$/;

/** A tilde fence's info string may contain anything, including backticks. */
const TILDE_OPENER = /^ {0,3}(~{3,})(.*)$/;

function maskAll(line: string): string {
  return MASK.repeat(line.length);
}

function openingFence(line: string): { char: string; length: number } | null {
  const backtick = BACKTICK_OPENER.exec(line);
  if (backtick !== null) return { char: '`', length: backtick[1].length };

  const tilde = TILDE_OPENER.exec(line);
  if (tilde !== null) return { char: '~', length: tilde[1].length };

  return null;
}

/**
 * A closing fence: same character, at least the opener's length, and nothing
 * after it but spaces and tabs. A closer may not carry an info string or
 * trailing text, so a line like `` ```txt `` never closes a backtick fence.
 */
function closesFence(line: string, fence: { char: string; length: number }): boolean {
  const escaped = fence.char === '`' ? '`' : '~';
  const pattern = new RegExp(`^ {0,3}(${escaped}{${fence.length},})[ \\t]*$`);
  return pattern.test(line);
}

/**
 * Masks inline code spans. A backtick run is closed by a run of exactly equal
 * length, per CommonMark; an unmatched run is left alone.
 */
export function maskInlineCode(line: string): string {
  const chars = [...line];
  let i = 0;

  while (i < chars.length) {
    if (chars[i] !== '`') {
      i += 1;
      continue;
    }

    const openStart = i;
    while (i < chars.length && chars[i] === '`') i += 1;
    const runLength = i - openStart;

    let j = i;
    let closed = false;
    while (j < chars.length) {
      if (chars[j] !== '`') {
        j += 1;
        continue;
      }
      const closeStart = j;
      while (j < chars.length && chars[j] === '`') j += 1;
      if (j - closeStart === runLength) {
        closed = true;
        break;
      }
    }

    if (!closed) continue;

    for (let k = openStart; k < j; k += 1) chars[k] = MASK;
    i = j;
  }

  return chars.join('');
}

/**
 * Masks fenced code blocks and inline code spans. Indented code blocks and raw
 * HTML blocks are deliberately left unmasked — see the spec.
 */
export function maskCode(input: string): string {
  let fence: { char: string; length: number } | null = null;

  return input
    .split('\n')
    .map((line) => {
      if (fence !== null) {
        // Only the closer rule applies to interior lines — the opener check
        // does not re-run, so a stray `` ```txt `` inside a fence is just
        // more masked content, not a nested (or accidentally re-opened) fence.
        if (closesFence(line, fence)) fence = null;
        return maskAll(line);
      }

      const opening = openingFence(line);
      if (opening !== null) {
        fence = opening;
        return maskAll(line);
      }

      return maskInlineCode(line);
    })
    .join('\n');
}
