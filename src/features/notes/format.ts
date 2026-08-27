import { hasQuery, normalizeForSearch } from './search';

/**
 * How much joined body text a snippet may carry.
 *
 * The row clamps to at most two lines of `text-ui-sm`, so anything past a
 * couple of hundred characters is cropped by CSS and never seen. The cap is
 * here rather than left to the clamp because the string also feeds the row's
 * `aria-label`, where nothing crops it and a screen reader would read the
 * whole note aloud.
 */
const SNIPPET_MAX_CHARS = 240;

/**
 * Markdown image syntax, removed from a preview because the row draws the
 * image itself (see `thumbnail.ts`). Without this, a note that opens with a
 * picture previews as `![](https://…)` — the URL, in place of the words the
 * user actually wrote.
 *
 * Deliberately looser than `thumbnail.ts`'s pattern: this one only has to
 * delete text, so matching an image whose URL that stricter pattern rejects
 * costs nothing, while missing one leaves a URL in the preview.
 */
const IMAGE_SYNTAX = /!\[[^\]]*\]\([^)]*\)/g;

/**
 * A table row or its delimiter: a line whose first non-space character is a
 * pipe.
 *
 * Dropped ENTIRELY rather than stripped of its pipes, which is the difference
 * between a preview and a mess. A table's cells are the shortest text in a
 * note and carry none of its sense — a two-line preview reading
 * `hi | a | b | c | | --- | --- | --- |` says nothing about the note and
 * looks broken, which is exactly the complaint that produced this. Whatever
 * prose surrounds the table is what the preview should show, and dropping the
 * table lines is what lets it.
 */
const TABLE_LINE = /^\s*\|/;

/** A fenced code block's delimiter, and the lines between two of them. */
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

/**
 * Leading block markers: heading hashes, list bullets, ordered-list numbers,
 * task checkboxes and blockquote arrows.
 *
 * Stripped from the FRONT of a line only, so a `#` inside prose (a tag, a
 * number sign) is untouched. The preview is prose, not source: `## Dairy`
 * reads as a heading in the editor and as punctuation noise in a two-line
 * summary, and `- [ ] Rewrite the seed helper` reads as a task in the editor
 * and as `- [ ]` in the row.
 *
 * Order matters: the checkbox pattern must run after the bullet that carries
 * it, which is why this is a sequence rather than one alternation.
 */
const BLOCK_MARKERS: readonly RegExp[] = [
  /^\s{0,3}#{1,6}\s+/,
  /^\s{0,3}>\s?/,
  /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/,
  /^\[[ xX]\]\s+/,
];

/**
 * A backslash escape's payload, held aside while the rules below run.
 *
 * Without this, `\*star\*` reads as an emphasis pair and the stripper deletes
 * the very characters the backslash was written to keep. NUL is the sentinel
 * because it cannot occur in a note: the editor's Markdown pipeline never
 * emits one, and it survives every pattern below as ordinary `\S` content.
 */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!~>|=])/g;
const SENTINEL = '\u0000';

/**
 * Inline Markdown, in the order it must be removed.
 *
 * ORDER IS LOAD-BEARING, in three places. Code spans go first, so their
 * contents are unwrapped before anything can read a `*` inside them as
 * emphasis. Autolinks (`<https://…>`) go before the raw-tag rule, which would
 * otherwise see `<https…>` as a tag and delete the address. And the emphasis
 * rules run longest delimiter first, so `***loud***` is not eaten as `**`
 * plus a stray `*`.
 *
 * Every pair requires a non-space character after its opening delimiter and
 * before its closing one — CommonMark's own rule, and the thing that keeps
 * `2 * 3 = 6` intact. An UNPAIRED delimiter is left alone on purpose: a
 * half-typed `**` is a note being written, and deleting one side of a pair
 * would silently drop the user's own characters.
 *
 * Underscore emphasis additionally refuses to fire intra-word, so
 * `some_var_name` survives; asterisks need no such guard because Markdown
 * itself has none for them.
 */
const INLINE_RULES: readonly (readonly [RegExp, string])[] = [
  [/(`+)([\s\S]*?)\1(?!`)/g, '$2'],
  [/<((?:https?|mailto):[^>\s]+)>/g, '$1'],
  [/<\/?[a-zA-Z][^<>]*>/g, ''],
  [/\[([^\][]*)\]\([^()]*\)/g, '$1'],
  [/\[([^\][]*)\]\[[^\]]*\]/g, '$1'],
  [/==(?=\S)([\s\S]*?\S)==/g, '$1'],
  [/~~(?=\S)([\s\S]*?\S)~~/g, '$1'],
  [/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '$1'],
  [/(?<!\w)___(?=\S)([\s\S]*?\S)___(?!\w)/g, '$1'],
  [/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1'],
  [/(?<!\w)__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1'],
  [/\*(?=\S)([\s\S]*?\S)\*/g, '$1'],
  [/(?<!\w)_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1'],
];

/**
 * Removes inline Markdown and inline HTML from one already-block-stripped
 * line, leaving the words the user wrote.
 *
 * This reverses the rule that stood here until 2026-08-27 — "inline marks are
 * deliberately left alone; they read as light emphasis rather than as
 * structure" — which was retired rather than caveated. It was wrong for one
 * concrete reason its argument never anticipated: a COLOURED highlight does
 * not serialize to a light delimiter, it serializes to real inline HTML
 * (`Highlight.ts`'s `renderMarkdown`), so a real note previewed as
 * `hi <mark class="hl-green">abcd</mark> hi, this is good.` — more characters
 * of attribute than of note. Once the tag has to go, no principled line keeps
 * `**` and drops `<mark>`: a preview is a summary, and the editor is where
 * syntax belongs.
 *
 * Deliberately a sequence of trims rather than a Markdown parse. It runs per
 * line, on text already stripped of block markers, and it must stay cheap
 * enough to run for every row in the list on every keystroke of a search. A
 * construct spanning two lines therefore loses only the delimiters sitting on
 * the line being trimmed — never content.
 */
function stripInline(line: string): string {
  const escaped: string[] = [];
  let text = line.replace(ESCAPE, (_match, character: string) => {
    escaped.push(character);
    return SENTINEL;
  });

  for (const [pattern, replacement] of INLINE_RULES) text = text.replace(pattern, replacement);

  // Split rather than a `replace` against a NUL pattern: a control character
  // in a regex literal is a lint warning, and splitting reads no worse.
  return text
    .split(SENTINEL)
    .map((part, index) => (index === 0 ? part : (escaped[index - 1] ?? '') + part))
    .join('');
}

/** Turns one Markdown line into the prose a preview should show, or `''`. */
function previewLine(line: string): string {
  if (TABLE_LINE.test(line) || FENCE_LINE.test(line)) return '';

  let text = line;
  for (const marker of BLOCK_MARKERS) text = text.replace(marker, '');
  // Images are removed BEFORE the inline rules, not after: the link rule would
  // otherwise take `![a](url)` down to a bare `!`.
  return stripInline(text.replace(IMAGE_SYNTAX, ' '));
}

/**
 * The preview shown beneath a note's title in the list: the body text that
 * follows the line `deriveTitle` consumed, with its blank lines closed up and
 * its remaining lines joined into one run of prose.
 *
 * Joined rather than "the first body line alone", which is what this returned
 * until the M9c row redesign: the row reserves two clamped lines at the
 * default density, and a single short body line filled exactly one of them, so
 * half the reserved height was blank for most notes. Joining lets the preview
 * fill the space it already occupies.
 *
 * With a `query`, it is instead the first line containing that query —
 * including the title line, which the no-query path deliberately skips. A
 * snippet that does not contain the match would render with nothing
 * highlighted, which reads as a false positive.
 *
 * The one exception: when the title line is the ONLY line that matches, this
 * still skips it, exactly like the no-query path. The title already renders
 * (highlighted) above the snippet, so repeating it here as the snippet would
 * print the same text twice with its raw `#` syntax exposed, and highlight
 * nothing new. When a body line also matches, the title-line match still
 * wins, as before — this exception only fires when the title is the sole
 * match.
 *
 * Markdown syntax is REMOVED, block and inline alike. This used to preview
 * the raw text verbatim, on the reasoning that the row shows what the user
 * typed — and on a note containing a table that produced
 * `hi | a | b | c | | --- | --- | --- |`, which shows nothing and looks
 * broken. A preview is a summary, not a source view; the editor is where the
 * syntax belongs. See `stripInline` for why the inline half followed.
 *
 * A `query` is matched against the STRIPPED lines, which is the only shape
 * that keeps a search row honest: `HighlightedText` searches the snippet this
 * returns, so a line chosen because it matched must still contain the match
 * after stripping — and nobody searches for `<mark`.
 */
export function deriveSnippet(text: string, query?: string): string {
  const lines = text
    .split('\n')
    .map((line) => previewLine(line).replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');

  const ordinarySnippet = (): string => {
    const body = lines.slice(1).join(' ');
    return body.length > SNIPPET_MAX_CHARS ? body.slice(0, SNIPPET_MAX_CHARS).trimEnd() : body;
  };

  if (query !== undefined && hasQuery(query)) {
    const target = normalizeForSearch(query.trim());
    const matches = (line: string): boolean => normalizeForSearch(line).includes(target);

    const titleLine = lines[0];
    if (titleLine !== undefined && matches(titleLine)) {
      const bodyMatch = lines.slice(1).find(matches);
      return bodyMatch !== undefined ? titleLine : ordinarySnippet();
    }

    const match = lines.find(matches);
    if (match !== undefined) return match;
    // Nothing matched this line-by-line — fall through to the ordinary
    // snippet rather than returning nothing.
  }

  return ordinarySnippet();
}

/**
 * `hourCycle: 'h23'` rather than `hour12: false`: the latter renders midnight
 * as 24:00 under some ICU builds.
 */
export function formatNoteDate(timestamp: number, locale: string, now: number): string {
  const when = new Date(timestamp);
  const today = new Date(now);

  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();

  return sameDay
    ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(when)
    : new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(when);
}
