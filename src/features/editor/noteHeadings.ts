import { headingSections } from './headingSections';
import { parseMarkdownDoc } from './markdown';

/**
 * The headings of a note's stored Markdown, for the `[[` popover's `/` mode.
 *
 * Goes through the REAL parser and the same `headingSections` walk the editor
 * uses, rather than scanning the text with a regex, and that is the whole
 * point of this module.
 *
 * A regex scanner existed first (`findHeadings`, in `src/data/links/`) and a
 * corpus agreement test caught it on its first run: `headingSections` reports
 * a heading's RENDERED text (`Some bold and code`) because it reads
 * `node.textContent`, while the scanner reported its SOURCE
 * (``Some **bold** and `code` ``). Any heading carrying inline formatting
 * would therefore have been offered by the popover, written into the link,
 * and then never found by the navigator — a link that silently does nothing,
 * with nothing on screen to explain it.
 *
 * Patching the scanner would have meant a second, partial inline-Markdown
 * implementation whose failures look exactly like that one. Using the parser
 * instead means there is only ONE heading reader in the app, so the two can
 * no longer disagree — which is better than the spec's plan of pinning two
 * readers to each other with a test.
 *
 * Cost, accepted knowingly: one full parse of the target note each time the
 * reader types `/` after a resolving title. That is the same parse opening
 * the note performs, and it happens once per target rather than per keystroke
 * (`RichEditor` keys its fetch on the title).
 */
export function noteHeadings(markdown: string): string[] {
  return headingSections(parseMarkdownDoc(markdown)).map((section) => section.text);
}
