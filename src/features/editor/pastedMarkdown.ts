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

/**
 * The four references `parseMarkdown` decodes itself, in exactly the spellings
 * it handles. Matched case-sensitively on purpose: `&AMP;` is a legacy alias
 * the parser does NOT decode, so it must fall through and be decoded here.
 */
const PARSER_HANDLED: ReadonlySet<string> = new Set(['amp', 'lt', 'gt', 'quot']);

/** Named, decimal and hexadecimal character references. */
const REFERENCE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decoded values, keyed by the reference as written.
 *
 * The decode itself needs a DOM element, and a large paste can carry hundreds
 * of references — most of them the same one. The cache keeps this one element
 * creation per DISTINCT reference rather than per occurrence.
 */
const decoded = new Map<string, string | null>();

/**
 * Decodes one reference, or `null` if the browser does not recognise it.
 *
 * A `<textarea>` rather than a library: `scripts/bundleSize.test.ts` leaves
 * 1,884 B of headroom on the eager chunk, which an entity package does not
 * fit into, and the DOM already carries the full table.
 *
 * A textarea SPECIFICALLY, because its content model is RCDATA: assigning
 * `innerHTML` decodes character references without parsing tags, so there is
 * no path to script execution even though the text came off a clipboard.
 */
function decodeReference(reference: string): string | null {
  const cached = decoded.get(reference);
  if (cached !== undefined) return cached;

  const probe = document.createElement('textarea');
  probe.innerHTML = reference;
  // Two ways this can fail to be a complete decode, and they look alike.
  // An unrecognised reference comes back verbatim. And a LEGACY entity
  // decodes without needing its semicolon — `&not` is real, so `&notareal;`
  // comes back as `¬areal;`, a decoded prefix plus an undecoded tail. Both
  // must be refused, or the second corrupts text it was asked to leave alone.
  // No named or numeric HTML reference decodes to a value containing `;`,
  // while every greedy prefix match leaves the tail's `;` behind — so that
  // is the tell.
  const complete = probe.value !== reference && !probe.value.includes(';');
  const value = complete ? probe.value : null;

  decoded.set(reference, value);
  return value;
}

/**
 * Decodes the HTML character references `parseMarkdown` does not.
 *
 * Applied on the PASTE path only, never to a note already on disk. A paste is
 * an import; typing is authoring. Fixing this inside `markdown.ts` would also
 * repair typed and existing notes, but it edits the one component whose
 * failure corrupts notes silently — see the spec's decision 3.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(REFERENCE, (match, body: string) => {
    if (PARSER_HANDLED.has(body)) return match;
    return decodeReference(match) ?? match;
  });
}
