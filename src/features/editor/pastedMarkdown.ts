/**
 * Pure helpers for the paste path. No ProseMirror, no clipboard, no event —
 * which is the point: this is where the decisions live, so this is where the
 * tests can be exhaustive and cheap.
 */

/**
 * Structural Markdown markers. Any ONE is enough.
 *
 * `^ {0,3}` on every line-anchored pattern is CommonMark's rule, not a
 * courtesy: four spaces of indent makes an indented code block, at which
 * point the marker is content rather than syntax.
 *
 * Emphasis (`**bold**`, `_em_`) is deliberately absent. See the docblock on
 * `looksLikeMarkdown`.
 */
const SIGNALS: readonly RegExp[] = [
  /^ {0,3}(?:```|~~~)/m,
  /^ {0,3}#{1,6} /m,
  /^ {0,3}(?:[-*+] |\d{1,9}[.)] )/m,
  /^ {0,3}> /m,
  /!?\[[^\]]*\]\([^)]*\)/,
];

/**
 * A table's delimiter row — the line of dashes under the header.
 *
 * Not a regex in `SIGNALS` because it is genuinely two conditions: the line
 * must be built only of table punctuation AND carry a run of dashes. A single
 * pattern for that is unreadable, and the failure mode of getting it wrong is
 * that any prose containing a pipe becomes a table.
 */
function hasTableDelimiterRow(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.includes('|') && /^[|:\-\s]+$/.test(trimmed) && /-{3,}/.test(trimmed);
  });
}

/**
 * Whether pasted text carries enough structure to be worth reading as
 * Markdown INSTEAD of an accompanying `text/html` flavour.
 *
 * This is the ONLY question this function answers, and the distinction
 * matters. A clipboard with no HTML flavour is always parsed as Markdown —
 * `MarkdownPaste` does not consult this — because the app is Markdown and a
 * rule the user cannot predict is worse than one that is occasionally wrong.
 * Here the choice is between two STRUCTURED readings of the same content, so
 * a wrong answer costs formatting fidelity rather than mangling a document.
 */
export function looksLikeMarkdown(text: string): boolean {
  return SIGNALS.some((signal) => signal.test(text)) || hasTableDelimiterRow(text);
}
