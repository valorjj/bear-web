/**
 * A note's title is the first non-empty line of its Markdown, with ATX heading
 * syntax removed. This is a derived cache — see `Note.title`.
 *
 * Exactly one level of heading syntax is stripped: '# # nested' yields
 * '# nested', because that is the heading's true Markdown content. Do not make
 * this idempotent — stripping twice would delete a character the user typed.
 */
export function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Only `#` followed by a space is a heading. `#tag` is a tag, not a heading.
    return trimmed.replace(/^#{1,6}\s+/, '').trim();
  }

  return '';
}
