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
 * A fenced-code-block delimiter line, with its info string captured.
 *
 * One pattern rather than two, because the opening and closing forms differ
 * only in whether group 2 is empty: an empty info string closes a fence, and
 * an info string of `markdown` opens one.
 *
 * `^ {0,3}` is CommonMark's own rule — four spaces of indent makes an indented
 * code block, not a fence — so a line indented that far is correctly not seen
 * as a fence at all.
 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*?)[ \t]*$/;

/** Splits on either line ending, keeping the terminator so it can be restored. */
const LINE = /(\r\n|\n|\r)/;

/**
 * Removes a ```` ```markdown ```` wrapper fence from a pasted payload, or
 * `null` when the payload is not of that shape.
 *
 * **This deliberately overrides CommonMark, whose rule is right in general and
 * produces garbage here.** A closing fence need only match the opening's
 * LENGTH, not its info string, so any fence nested inside a
 * ```` ```markdown ```` wrapper closes the wrapper early. The user's real Gemini answer
 * (`fixtures/geminiAnswer.plain.txt`, committed verbatim) opens its wrapper on
 * line 5 and means to close it on line 93, but the ASCII diagram at lines
 * 63/69 carries its own fence — so CommonMark closes the wrapper at line 63
 * and parsing yields 3 paragraphs and 2 code blocks with the diagram stranded
 * between them.
 *
 * **Preferring the `text/html` flavour cannot fix it**, which is why this
 * exists at all rather than being handled upstream by `htmlCarriesStructure`.
 * Gemini's HTML for the same clipboard is mangled identically — verified by
 * stripping every `<pre>` and finding the diagram outside both of them — so
 * there is no faithful flavour to defer to.
 *
 * **Measured.** Dropping the two wrapper lines and parsing the rest yields
 * `{heading: 10, bulletList: 3, horizontalRule: 4, paragraph: 3, table: 1,
 * orderedList: 3, codeBlock: 1}` — 25 top-level nodes, the whole document,
 * with the ASCII diagram correctly a single code block.
 *
 * **The override is narrow on purpose, and two conditions do that work.** The
 * info string must say `markdown` or `md`, which is the SOURCE declaring this
 * payload to be a Markdown document rather than us guessing. And the close
 * must be the payload's last non-blank line, so the wrapper demonstrably runs
 * to the end of the clipboard. A fence tagged anything else, or one that
 * closes mid-payload, is left entirely alone and parses under CommonMark's
 * ordinary rule.
 *
 * Note what is NOT required: that the fence wrap the whole payload. This one
 * does not — lines 1-4 are Korean prose preamble. Only the two wrapper lines
 * are removed, so the preamble survives as prose and the nested fences are
 * handed to the parser untouched, which is precisely what produces the counts
 * above.
 */
export function unwrapMarkdownFence(text: string): string | null {
  const pieces = text.split(LINE);
  // `split` with a capturing group yields `line, eol, line, eol, …, line`, so
  // line `i` is `pieces[i * 2]` and its terminator `pieces[i * 2 + 1]`.
  const count = (pieces.length + 1) / 2;

  let open = 0;
  let fence = FENCE_LINE.exec(pieces[0]);
  // The FIRST fence line, whatever it is tagged. Scanning past a
  // ```` ```ts ```` fence to find a later markdown-tagged one would be reading
  // a nested fence as a wrapper.
  while (fence === null && ++open < count) fence = FENCE_LINE.exec(pieces[open * 2]);
  if (fence === null) return null;

  const tag = fence[2].toLowerCase();
  if (tag !== 'markdown' && tag !== 'md') return null;

  let close = count - 1;
  while (close > open && pieces[close * 2].trim() === '') close -= 1;
  // At least one line between the two, so there is a document to unwrap.
  if (close - open < 2) return null;

  const closing = FENCE_LINE.exec(pieces[close * 2]);
  // Bare, of the same character, and at least as long — CommonMark's own
  // closing rule, which this override keeps rather than loosens.
  if (closing === null || closing[2] !== '') return null;
  if (closing[1][0] !== fence[1][0] || closing[1].length < fence[1].length) return null;

  // Whichever kept line ends the result loses its terminator, so removing the
  // last line removes a line rather than leaving a blank one behind. Every
  // other line keeps the ending it arrived with.
  const last = close === count - 1 ? count - 2 : count - 1;
  const kept: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i === open || i === close) continue;
    kept.push(i === last ? pieces[i * 2] : pieces[i * 2] + pieces[i * 2 + 1]);
  }
  return kept.join('');
}

/** Any line that opens or closes a fenced code block. */
const FENCE_ANYWHERE = /^ {0,3}(?:`{3,}|~{3,})/m;

/**
 * Whether an unwrapped payload contains a fence of its own.
 *
 * This is the PRECEDENCE test between `unwrapMarkdownFence` and
 * `htmlCarriesStructure`, not a further condition on the unwrap — and the
 * distinction is the whole ruling. A nested fence is what makes CommonMark's
 * greedy close destructive, and measured on the two real payloads it is also
 * what makes the SOURCE'S OWN HTML unreliable: Gemini's HTML is mangled in
 * the same place as its plain text, with the ASCII diagram outside every
 * `<pre>`. So an interior fence means neither flavour can be trusted and our
 * unwrap is the only faithful reading; its absence means the wrapper was
 * harmless, CommonMark would have parsed the payload correctly anyway, and a
 * structural HTML flavour is the better one.
 *
 * Measured, which is why this exists at all. Interior fence lines: **2** in
 * `fixtures/geminiAnswer.plain.txt`, **0** in the two-flavour payload
 * `e2e/pasteMarkdown.spec.ts` pastes — whose HTML declares a real `h2` and a
 * real `table` against a plain flavour whose table is ASCII art. Making the
 * interior fence a condition on unwrapping instead would have left a clean
 * wrapper with NO html flavour parsing as a single code block, which is the
 * document the user asked us to stop producing.
 */
export function containsFence(text: string): boolean {
  return FENCE_ANYWHERE.test(text);
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
