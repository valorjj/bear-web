import type { Node } from '@tiptap/pm/model';

/**
 * Stands in for a character a tag may not contain. `\u0000` deliberately, not
 * a space: a space before a `#` satisfies the tag grammar's start rule and
 * would turn `` `x`#work `` into a tag. This is the same convention
 * `src/data/tags/parseTags.ts` uses for masking code in Markdown.
 *
 * Must always be written as this four-character escape sequence — a literal
 * NUL byte looks identical in an editor and is silently mangled by grep and
 * diff.
 */
export const MASK = '\u0000';

/**
 * A textblock's content as a string with EXACTLY one character per document
 * position inside it, so a character at index `i` is at document position
 * `blockPos + 1 + i`.
 *
 * `node.textContent` cannot be used: a `hardBreak` contributes no characters
 * but occupies a position, which shifts every later offset. Non-text inline
 * nodes therefore contribute one substitute character per position.
 *
 * A `hardBreak` specifically contributes `'\n'`, not `MASK`. A hard break
 * really is a line break: serialized to Markdown, a tag immediately after one
 * genuinely sits at the start of a line, and `parseTags` finds it there. A
 * newline is whitespace, so — unlike `MASK` — it both terminates a tag AND
 * permits one to start, which is exactly the asymmetry this position needs.
 * `MASK` is deliberately incapable of the "permits a start" half, so it stays
 * reserved for masked code, and every other non-text inline node still gets
 * `MASK.repeat(child.nodeSize)`.
 *
 * Text carrying the `code` mark is masked WHOLE, so an inline code span cannot
 * hold a tag. That mirrors `parseTags`, which masks backticked spans in
 * Markdown.
 *
 * Text carrying any other mark has its FIRST character masked, and only its
 * first. Every mark in this schema — `bold`, `italic`, `strike`, `highlight`,
 * `link`, `code` — serializes with an opening delimiter (`**`, `*`, `~~`,
 * `==`, `[`, `` ` ``), verified against the real serializer rather than
 * assumed. So the first character of a marked run is USUALLY preceded by `*`,
 * `~`, `=`, `[` or `` ` `` in the Markdown rather than by whitespace, and
 * `parseTags` refuses to start a tag there. The document holds no such
 * character, so without this the plugin would accept `**#bravo**` as the tag
 * `bravo` while
 * the index — correctly — holds nothing: **a pill asserting something false
 * about the user's data**, which is strictly worse than a missing pill.
 *
 * "Usually" is exact, not hedging. The one exception is a run whose own
 * LEADING WHITESPACE the serializer hoists outside the delimiter: a bold run
 * of `'  #work'` between `pre` and `post` serializes to `pre  **#work**post`,
 * so the space moved out and the delimiter landed against the `#`. Masking
 * this run's first character consumes only the first of its two spaces, the
 * second still permits a tag to start, and the pill lies. It needs two or
 * more leading whitespace characters — with exactly one, the mask covers it
 * and the two views agree — and it is unreachable from Markdown, only from
 * applying a mark over leading whitespace in the UI. Pinned in
 * `tagAgreement.test.ts`; see `CLAUDE.md`.
 *
 * Masking the run WHOLE would be wrong. `**see #work**` serializes with the
 * `#` preceded by a space, `parseTags` finds a tag there, and removing the
 * pill would trade one disagreement for another. Masking exactly one
 * character also keeps the one-character-per-position invariant intact.
 *
 * Any mark added to this schema later is covered by default, in the fail-safe
 * direction — a mark that somehow serialized without a leading delimiter
 * would lose a pill rather than invent one.
 *
 * What this does NOT close is a mark's CLOSING delimiter landing inside or
 * against a tag's own characters, which the document likewise cannot show:
 * `**see #work**` indexes as `work**`, not `work`. See `CLAUDE.md` and
 * `tagAgreement.test.ts`, which pins the residue.
 */
export function maskedBlockText(node: Node): string {
  let out = '';
  node.forEach((child) => {
    if (!child.isText || child.text === undefined) {
      out +=
        child.type.name === 'hardBreak' ? '\n'.repeat(child.nodeSize) : MASK.repeat(child.nodeSize);
      return;
    }
    if (child.marks.some((mark) => mark.type.name === 'code')) {
      out += MASK.repeat(child.text.length);
      return;
    }
    // One UTF-16 code unit replaced by one, because ProseMirror positions
    // count code units: a run opening on an astral character keeps its length
    // and therefore every later offset.
    out += child.marks.length === 0 ? child.text : MASK + child.text.slice(1);
  });
  return out;
}
