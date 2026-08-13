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
 *
 * `/` is deliberately absent: a leading slash always produces an empty first
 * `/`-separated segment (`#/bin` splits to `['', 'bin']`), which the
 * empty-segment rule in `normalizeTag` already rejects. Content starting with
 * `#!/bin/sh` still rejects too, via the leading `!`. Keeping `/` here as well
 * was a rule enforced by nothing — see the parser test suite, which is green
 * with or without it.
 */
const LEADING_REJECT = /^[.,;:!?]/;

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

/**
 * Whether a candidate closing `#` at `close` sits on the same line as `from`.
 * Bounded to `[from, close)` rather than scanning to end-of-line: on a long
 * single line with a nearby closer, an unbounded scan to end-of-line on every
 * candidate `#` is what made parsing quadratic (a 900 KB line of `'#a '`
 * measured 2.1s before this fix). `close` is always found first by the
 * caller, so this never scans past it.
 */
function closesOnSameLine(text: string, from: number, close: number): boolean {
  // `text.indexOf('\n', from)` is the wrong tool here: when no newline exists
  // between `from` and the end of the (possibly huge) string, `indexOf` scans
  // all the way to the end to find that out, on every call. Slicing to just
  // `[from, close)` first bounds that scan to the gap between two consecutive
  // `#` characters — summed over a whole parse, that gap total is O(n), not
  // O(n) per candidate.
  return !text.slice(from, close).includes('\n');
}

export interface TagRange {
  /** The normalized tag name, exactly as `parseTags` would report it. */
  tag: string;
  /** Index of the opening `#` in the ORIGINAL input. */
  start: number;
  /**
   * Index one past the tag's last character. For the multi-word form this
   * includes the closing `#` — it is tag syntax, not prose punctuation. For
   * the simple form, trailing punctuation trimmed by `normalizeTag` (as in
   * `#done.`) is excluded — a pill has no business painting a sentence's
   * full stop.
   */
  end: number;
}

/**
 * Every tag occurrence, with its position. `parseTags` is the deduped
 * name-only view of this — one grammar, two views.
 *
 * `maskCode` replaces characters one-for-one, so an index into the masked
 * copy is an index into the original. `parseTags.test.ts` pins that.
 */
export function findTagRanges(markdown: string): TagRange[] {
  const text = maskCode(markdown);
  const ranges: TagRange[] = [];
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

    const close = text.indexOf('#', open + 1);

    let content: string | null;
    let consumedEnd: number;
    let isMultiWord: boolean;

    if (
      close !== -1 &&
      closesOnSameLine(text, open + 1, close) &&
      isBoundary(text[close + 1]) &&
      !isWhitespace(text[close - 1])
    ) {
      // Multi-word form. The closing hash must be followed by a boundary, which
      // is what stops `#a #b` from reading as one tag named `a `, and must NOT
      // be preceded by whitespace, symmetric with the boundary-after rule —
      // otherwise `Fix #bug then see item # 5` reads the far, unrelated `#` as
      // this tag's closer and swallows the prose between them.
      content = text.slice(open + 1, close);
      consumedEnd = close + 1;
      isMultiWord = true;
    } else {
      let j = open + 1;
      while (j < text.length && !isBoundary(text[j])) j += 1;
      const simple = text.slice(open + 1, j);
      // A simple tag may not contain a hash, which is what rejects `###`.
      content = simple.includes('#') ? null : simple;
      consumedEnd = j;
      isMultiWord = false;
    }

    if (content !== null) {
      const tag = normalizeTag(content);
      if (tag !== null) {
        // The multi-word form's closing `#` is tag syntax, so its range runs
        // to `consumedEnd` (past the closer) unmodified. The simple form has
        // no closer, so the range instead describes the TRIMMED NAME: `content`
        // already has no leading or trailing whitespace (canStart/isBoundary
        // guarantee the first character starts the tag, and the simple-form
        // scan stops at the first boundary), so the only thing `normalizeTag`
        // trims that shifts the END is `trimTrailing`'s punctuation strip —
        // reapplying it here to the untouched `content` reproduces exactly
        // how many characters were dropped from the tail. Without this,
        // `#done.` would paint a pill over the sentence's own full stop.
        const end = isMultiWord ? consumedEnd : open + 1 + trimTrailing(content).length;
        ranges.push({ tag, start: open, end });
      }
    }

    i = consumedEnd;
  }

  return ranges;
}

export function parseTags(markdown: string): string[] {
  return [...new Set(findTagRanges(markdown).map((range) => range.tag))];
}
