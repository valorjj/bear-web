/** The formats a single note can be exported as. `pdf` goes through the browser's print pipeline and never reaches this. */
export type ExportExtension = 'md' | 'html';

/** Just enough of a note to name a file after it. */
export interface NamedNote {
  title: string;
  updatedAt: number;
}

/**
 * Everything Windows, macOS or Linux rejects in a filename. Deliberately
 * REPLACED with a hyphen rather than dropped: dropping silently joins words, so
 * `a/b` would become `ab` and two notes that differ only across a separator
 * could collide on one name.
 *
 * Spaces are deliberately NOT in this set. Every target filesystem accepts them,
 * and replacing them would rewrite every multi-word title into kebab-case — a
 * change to the user's own words, not a safety measure.
 *
 * Control characters are also absent, and that is a judgement rather than an
 * oversight: `deriveTitle` takes one trimmed line, so a newline cannot reach
 * here, and the remaining range is unreachable in practice.
 */
const FORBIDDEN = /[/\\:*?"<>|]+/g;

/**
 * The common single-component limit is 255 BYTES on ext4 and APFS, not 255
 * characters — and a Hangul syllable is three bytes in UTF-8, so a
 * character-based cap would let a 200-character Korean title through at 600
 * bytes and the write would fail.
 */
const MAX_NAME_BYTES = 255;

/** Truncates to a byte budget on a character boundary, never mid-code-point. */
function clampBytes(value: string, budget: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= budget) return value;

  // Iterated by code point (`for...of`), so an astral character is one unit and
  // cannot be halved into a replacement character.
  let out = '';
  let used = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (used + size > budget) break;
    out += character;
    used += size;
  }
  return out;
}

/**
 * A filename for one note in one format.
 *
 * The date fallback matters more than it looks: an untitled note, or one whose
 * title is nothing but forbidden characters, still has to produce something the
 * user can find on disk afterwards.
 */
export function exportFilename(note: NamedNote, extension: ExportExtension): string {
  const stem = note.title
    .replace(FORBIDDEN, '-')
    // A leading dot hides the file on Unix; a trailing dot or space is silently
    // stripped by Windows, which turns two distinct exports into one name.
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .replace(/-{2,}/g, '-');

  const suffix = `.${extension}`;
  const fallback = new Date(note.updatedAt).toISOString().slice(0, 10);
  const chosen = stem === '' || stem === '-' ? fallback : stem;

  return `${clampBytes(chosen, MAX_NAME_BYTES - suffix.length)}${suffix}`;
}
