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
 * Text carrying the `code` mark is masked, so an inline code span cannot hold
 * a tag. That mirrors `parseTags`, which masks backticked spans in Markdown.
 */
export function maskedBlockText(node: Node): string {
  let out = '';
  node.forEach((child) => {
    if (!child.isText || child.text === undefined) {
      out +=
        child.type.name === 'hardBreak' ? '\n'.repeat(child.nodeSize) : MASK.repeat(child.nodeSize);
      return;
    }
    const isCode = child.marks.some((mark) => mark.type.name === 'code');
    out += isCode ? MASK.repeat(child.text.length) : child.text;
  });
  return out;
}
