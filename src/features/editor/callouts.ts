/**
 * The callout roster and its marker grammar.
 *
 * Deliberately free of Tiptap, React and i18n: the round-trip suites drive
 * these functions directly, and the Markdown contract they implement is the
 * one irreversible decision in M9b — it goes into note text and cannot change
 * later without rewriting every note that has a callout. Keeping the grammar
 * in a module with no dependencies is what lets it be tested exhaustively
 * without a schema, an editor or a DOM.
 *
 * See `docs/superpowers/specs/2026-08-27-m9b-callout-blocks-design.md` §3.
 */

/** The five, and only five. Also the order the chevron menu lists them in. */
export const CALLOUT_TYPES = ['info', 'tip', 'success', 'warning', 'danger'] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(CALLOUT_TYPES);

/**
 * Spellings accepted on READ, normalized to a canonical type on write.
 *
 * The point is that a note pasted from Obsidian or GitHub becomes ours without
 * losing meaning. The cost, recorded in the spec's §12 and not fixable within
 * this design: `failure` and `danger` both become `danger`, so someone who
 * meant them differently has no way to say so.
 *
 * Canonical spellings are deliberately absent as keys — `TYPE_SET` covers them
 * — so this table can never disagree with the roster about what `warning`
 * means.
 */
const ALIASES: Readonly<Record<string, CalloutType>> = {
  note: 'info',
  abstract: 'info',
  summary: 'info',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  caution: 'warning',
  attention: 'warning',
  error: 'danger',
  failure: 'danger',
  bug: 'danger',
};

/**
 * `[!word]` at the very start of a block, with at most one space after it.
 *
 * Anchored, because a `[!x]` mid-sentence is prose and claiming it would eat
 * the user's text. The word itself excludes `]` and newlines and is otherwise
 * unrestricted — Korean, emoji and spaces all reach `rawMarker` intact rather
 * than being refused for not looking like an identifier.
 */
const MARKER = /^\[!([^\]\n]+)\][ \t]?/;

export interface ParsedMarker {
  /** The canonical type, or `null` for a word outside the roster. */
  type: CalloutType | null;
  /** The word exactly as written, which is what an unknown marker round-trips. */
  raw: string;
  /** Text after the marker, up to the first newline. `''` when absent. */
  title: string;
  /**
   * Everything after that first newline, `''` when there is none.
   *
   * Non-empty only for the TIGHT form (`> [!warning] T` then `> Body.`), which
   * the parser renders as ONE paragraph carrying a hard newline — verified
   * against the real pipeline on 2026-08-27, not assumed. Obsidian and GitHub
   * both write that form, so it has to be split back apart here.
   */
  rest: string;
}

/** Reads a marker off the start of a block's text, or declines. */
export function parseMarker(text: string): ParsedMarker | null {
  const match = MARKER.exec(text);
  if (match === null) return null;

  const raw = match[1]!;
  const lower = raw.toLowerCase();
  const type = TYPE_SET.has(lower) ? (lower as CalloutType) : (ALIASES[lower] ?? null);

  const remainder = text.slice(match[0].length);
  const newline = remainder.indexOf('\n');

  return newline === -1
    ? { type, raw, title: remainder, rest: '' }
    : { type, raw, title: remainder.slice(0, newline), rest: remainder.slice(newline + 1) };
}

/**
 * Writes the marker back.
 *
 * A recognised type writes its CANONICAL spelling, which is what normalizes
 * `[!CAUTION]` to `[!warning]` on save. `raw` is consulted only when there is
 * no type, and is the whole reason an unrecognised marker survives.
 */
export function formatMarker(type: CalloutType | null, raw: string | null): string {
  return `[!${type ?? raw ?? ''}]`;
}
