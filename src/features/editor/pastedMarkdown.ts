/**
 * Pure helpers for the paste path. No ProseMirror, no clipboard, no event —
 * which is the point: this is where the decisions live, so this is where the
 * tests can be exhaustive and cheap.
 */

/**
 * Tags whose presence means the HTML flavour carries information its
 * plain-text sibling has lost.
 *
 * `a` is in this list and that is the point of the list: a paragraph copied
 * off a web page has a link in its HTML and NOTHING in its plain text, so
 * treating it as trivial would silently drop the link. Emphasis, code and
 * table parts are here for the same reason. Only pure wrappers — `div`,
 * `span`, `p`, `br` and the document scaffolding a clipboard payload comes
 * wrapped in — are absent, because a payload built only from those is a
 * plain-text document that happens to have been dressed in HTML, and its
 * Markdown reading is the better one.
 *
 * In full, and in the order the pattern lists them: `h1`-`h6`; `ul`, `ol`,
 * `li`, `dl`, `dt`, `dd`; `table`, `thead`, `tbody`, `tfoot`, `tr`, `td`,
 * `th`; `pre`, `code`, `blockquote`, `img`, `a`; `strong`, `b`, `em`, `i`,
 * `del`, `s`, `u`, `mark`, `hr`.
 *
 * One regex LITERAL rather than the obvious `TAGS.join('|')` over a named
 * array, and the reason is measured, not stylistic. The array-and-join form
 * built this same pattern for **+28 B** gzipped on the eager closure
 * (347,253 B against this form's 347,225 B), which would have made a defect
 * fix GROW the bundle by 12 B over its base — and the closure is functionally
 * spent, with 775 B of headroom under the frozen 348,000 B ceiling. The list
 * spelled out above is the readability the named array would have bought.
 *
 * The `[\s/>]` lookahead is the whole subtlety. Without it `<article>`
 * matches `a` and `<tablet>` matches `table`, so any page's own wrapper
 * markup reads as structure and the Markdown path becomes unreachable.
 */
const STRUCTURAL_HTML =
  /<(?:h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|pre|code|blockquote|img|a|strong|b|em|i|del|s|u|mark|hr)(?=[\s/>])/i;

/**
 * Whether a `text/html` clipboard flavour should be trusted over re-parsing
 * its plain-text sibling as Markdown.
 *
 * Measured, not assumed. A Gemini answer's plain flavour wrapped the whole
 * document in a ```` ```markdown ```` fence whose content held a NESTED
 * fence; the inner fence closed the outer one early, and parsing it produced
 * two code blocks with an ASCII diagram stranded between them. The HTML
 * flavour of the same clipboard described exactly one code block. A second
 * answer from the same source carried real headings and a real table in its
 * HTML that its plain text could only approximate.
 *
 * So the rule is not "which flavour looks more like Markdown" but "did the
 * source tell us the structure". If it did, believe it.
 */
export function htmlCarriesStructure(html: string): boolean {
  return STRUCTURAL_HTML.test(html);
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
