// The explicit `.ts` extensions here and in `parseTags.ts` are load-bearing,
// and they are the only two in `src/data/` that need one.
// `scripts/corpus.test.ts` imports this file, which pulls it into the `node`
// tsconfig project — `module: nodenext`, where a relative specifier must carry
// its extension — while every other consumer reaches it through the `app`
// project's `bundler` resolution, where it may not. Both projects set
// `allowImportingTsExtensions`, so the extension is the one spelling that
// satisfies the pair. Drop either and `npm run typecheck` fails with TS2834.
//
// The LEAF, not the `./tags` barrel, and that is the whole reason the cascade
// stops at two files: the barrel re-exports `rewriteTag` as well, so importing
// it would drag the entire tag module into `nodenext` and every specifier in
// it would need the same treatment. `parseTags.ts` imports only
// `../markdown/mask`, which imports nothing.
import { findTagRanges } from './tags/parseTags.ts';

/**
 * Whether a line says nothing once its tags are taken out.
 *
 * Uses `findTagRanges` rather than a regex of its own, for the reason the
 * preview's `stripTags` gives: a hand-rolled `#\S+` would count `#42` as a
 * tag, which `normalizeTag` rejects as all-numeric and which is therefore
 * prose, and it would count a `#work` inside a code span, where the editor
 * draws no pill either. One grammar, three consumers.
 */
function isTagOnly(line: string): boolean {
  const ranges = findTagRanges(line);
  if (ranges.length === 0) return false;

  let rest = '';
  let at = 0;
  for (const range of ranges) {
    rest += line.slice(at, range.start);
    at = range.end;
  }
  return (rest + line.slice(at)).trim() === '';
}

/**
 * A note's title is the first non-empty line of its Markdown, with ATX heading
 * syntax removed. This is a derived cache — see `Note.title`.
 *
 * Exactly one level of heading syntax is stripped: '# # nested' yields
 * '# nested', because that is the heading's true Markdown content. Do not make
 * this idempotent — stripping twice would delete a character the user typed.
 *
 * A line that is NOTHING BUT TAGS is skipped along with the blank ones, and
 * that is not a nicety. Creating a note inside a tag scope seeds `\n#a/b` —
 * `AppShell`'s create handler writes a deliberately empty title line with the
 * tag below it, so the caret lands on an unnamed title. This function skipped
 * the blank line, landed on the tag, and titled the row `#a/b`: a note the
 * user had not named yet looked named, and the name was one they never typed.
 *
 * Only a line with nothing else goes. A tag beside real words is part of what
 * the line says (`#work Rewrite the seed helper` titles as written), because
 * a tag is content in this app's grammar — the same reason `notes.duplicate`
 * copies tags verbatim rather than stripping them.
 */
export function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (isTagOnly(trimmed)) continue;

    // Only `#` followed by a space is a heading. `#tag` is a tag, not a heading.
    return trimmed.replace(/^#{1,6}\s+/, '').trim();
  }

  return '';
}
