import { maskCode } from '../markdown/mask';

/**
 * ATX headings only. Setext (`===` underlines) is not produced by this app's
 * serializer, so supporting it here would add a rule the document walker in
 * `headingSections` has no counterpart for — and the two must agree.
 */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;

/**
 * Every heading in a note's stored Markdown, in document order, EXCLUDING the
 * note's own title.
 *
 * Lives in `src/data/` rather than beside the editor because the `[[`
 * autocomplete needs the headings of a note that is NOT open, and `src/data/`
 * may not import from `src/features/`.
 *
 * This is the second of two heading readers, and the risk is named in the spec
 * rather than left to be discovered: `headingSections` walks the live
 * ProseMirror document and is authoritative for what is on screen, while this
 * one reads text for a note nobody has opened. They cannot be collapsed —
 * different inputs — so they share `normalizeTitle` as the comparison key and
 * `headingAgreement.test.ts` asserts they agree across the corpus.
 *
 * The first block is skipped for the same reason `headingSections` skips
 * offset 0: it is the note's name, not a section. "First block" means the
 * first NON-BLANK line, because Markdown drops leading blank lines on parse.
 */
export function findHeadings(markdown: string): string[] {
  const lines = markdown.split('\n');
  // Masked line-for-line, so a `#` inside a fence cannot open a heading. The
  // mask preserves length, so the two arrays stay index-aligned.
  const masked = maskCode(markdown).split('\n');

  const found: string[] = [];
  let seenBlock = false;

  lines.forEach((line, index) => {
    const maskedLine = masked[index] ?? '';
    if (maskedLine.trim() === '') return;

    const isHeading = HEADING.test(maskedLine);
    const wasFirst = !seenBlock;
    seenBlock = true;
    if (!isHeading || wasFirst) return;

    const match = HEADING.exec(line);
    if (match === null) return;
    // A closing sequence (`## Closed ##`) is decoration, not text.
    const text = (match[2] ?? '').replace(/\s+#+\s*$/, '').trim();
    if (text !== '') found.push(text);
  });

  return found;
}
