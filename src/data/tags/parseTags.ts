/**
 * The real tag parser. Pure, and deliberately importing nothing: it runs
 * inside a Dexie transaction on every save and across every note during a
 * rebuild, so tokenizing with `marked` — correct but heavy, and a coupling
 * from `src/data/` to the editor's Markdown library — was rejected.
 *
 * See `docs/superpowers/specs/2026-08-10-m5-tags-design.md` for the full
 * grammar and the rulings behind it.
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
const MASK = '\u0000';

/**
 * A backtick fence's info string may not itself contain a backtick (per
 * CommonMark); a line that merely starts with an inline code span, like
 * `` ```code``` is inline ``, is a paragraph, not a fence opener.
 */
const BACKTICK_OPENER = /^ {0,3}(`{3,})([^`]*)$/;

/** A tilde fence's info string may contain anything, including backticks. */
const TILDE_OPENER = /^ {0,3}(~{3,})(.*)$/;

/**
 * Content starting with one of these is thrown away whole rather than trimmed,
 * so a shebang in an unmasked indented code block yields nothing instead of a
 * tag named `bin/sh`. Deliberately narrow — `#-lead` is a legitimate tag, so
 * this must not widen to "any non-word character".
 */
const LEADING_REJECT = /^[.,;:!?/]/;

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/** Ends a tag: whitespace, a masked character, or the end of the input. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === MASK || isWhitespace(ch);
}

/** Permits a tag to start: the very beginning, or whitespace. Never a mask. */
function canStart(ch: string | undefined): boolean {
  return ch === undefined || isWhitespace(ch);
}

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
function maskInlineCode(line: string): string {
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
function maskCode(input: string): string {
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

/**
 * Trims punctuation and slashes from the END, repeatedly, so `#done./` settles
 * on `done`. Deliberately not applied to the start: trimming there would turn
 * a shebang into the tag `bin/sh`, so a leading offender rejects instead.
 */
function trimTrailing(input: string): string {
  let value = input;
  let previous: string;
  do {
    previous = value;
    value = value.replace(/[.,;:!?/]+$/, '');
  } while (value !== previous);
  return value;
}

function normalizeTag(raw: string): string | null {
  // Deliberate asymmetry between the two tag forms: the simple-form scanner
  // stops AT a mask, so `#work`x`` yields `work` — the mask is a boundary,
  // never inspected. The multi-word form takes the far `#` as its closer
  // first and only then checks the whole span for a mask, so
  // `#project `x` plan#` discards the entire candidate, including the clean
  // `project` prefix, rather than truncating to it. Do not "fix" this by
  // falling back to a simple-form scan when a mask is found — that is an
  // unapproved behaviour change, not a bug fix.
  if (raw.includes(MASK)) return null;

  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (LEADING_REJECT.test(collapsed)) return null;

  const trimmed = trimTrailing(collapsed).toLowerCase();
  if (trimmed === '') return null;

  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '')) return null;
  if (segments.every((segment) => /^\d+$/.test(segment))) return null;

  return trimmed;
}

function lineEndFrom(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline === -1 ? text.length : newline;
}

export function parseTags(markdown: string): string[] {
  const text = maskCode(markdown);
  const found: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '#' || !canStart(text[i - 1])) {
      i += 1;
      continue;
    }

    const open = i;
    if (isBoundary(text[open + 1])) {
      i = open + 1;
      continue;
    }

    const lineEnd = lineEndFrom(text, open + 1);
    const close = text.indexOf('#', open + 1);

    let content: string | null;
    let end: number;

    if (close !== -1 && close < lineEnd && isBoundary(text[close + 1])) {
      // Multi-word form. The closing hash must be followed by a boundary, which
      // is what stops `#a #b` from reading as one tag named `a `.
      content = text.slice(open + 1, close);
      end = close + 1;
    } else {
      let j = open + 1;
      while (j < text.length && !isBoundary(text[j])) j += 1;
      const simple = text.slice(open + 1, j);
      // A simple tag may not contain a hash, which is what rejects `###`.
      content = simple.includes('#') ? null : simple;
      end = j;
    }

    const tag = content === null ? null : normalizeTag(content);
    if (tag !== null) found.push(tag);
    i = end;
  }

  return [...new Set(found)];
}
