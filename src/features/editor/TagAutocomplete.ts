import type { EditorState } from '@tiptap/pm/state';

import { normalizeTag } from '@/data';

import { MASK, maskedBlockText } from './blockText';

/** No result list is ever longer than this. Prefix and substring matching
 * only, deliberately — the same ruling `LinkAutocomplete`'s `matchingTitles`
 * rests on: a fuzzy ranker is a tuning problem with no end. */
export const MAX_RESULTS = 8;

export interface TagAutocompleteMatch {
  /** Document position of the opening `#`. */
  from: number;
  /** Document position of the caret, one past the last typed character. */
  to: number;
  /** The typed tag text, without the leading `#`. */
  query: string;
}

/** Whitespace, a masked character, or the edge of the block — the same
 * boundary set `parseTags`' own `isBoundary` uses. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === MASK || /\s/.test(ch);
}

/**
 * The live, unclosed tag immediately before the caret, or `null`.
 *
 * Walks the same shape of guard as `linkAutocompleteMatchAt`, and reuses
 * `maskedBlockText` for the same two reasons: masking turns an inline-code
 * span's characters into `MASK`, so a literal `#work` inside backticks cannot
 * open this list, and the one-character-per-position invariant keeps
 * `parentOffset` a valid index into the masked string with no separate offset
 * arithmetic for non-text children.
 *
 * The rule that differs from the link grammar is the REQUIRED BOUNDARY AFTER
 * THE CARET, and it does three jobs at once. It refuses `#wo|rk`, where
 * accepting a suggestion would replace `#wo` and strand `rk`. It excludes the
 * multi-word form `#a b#` by construction rather than by a guard, because
 * whitespace is a boundary. And it leaves the repair path intact, because
 * deleting-to-the-end is how a mistyped tag is fixed.
 */
export function tagAutocompleteMatchAt(state: EditorState): TagAutocompleteMatch | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  // The same two-fold guard `tagRangeAt` documents: rejects everywhere this
  // grammar cannot apply, and keeps `before()` below from throwing at depth 0,
  // where the parent is the document itself.
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;

  const text = maskedBlockText($from.parent);
  const before = text.slice(0, $from.parentOffset);
  const openAt = before.lastIndexOf('#');
  if (openAt === -1) return null;

  // `canStart` in the real parser: a tag begins at the block start or after
  // whitespace, never mid-word and never after a mask.
  const preceding = openAt === 0 ? undefined : before[openAt - 1];
  if (preceding !== undefined && !/\s/.test(preceding)) return null;

  const query = before.slice(openAt + 1);
  // At least one character, which keeps this out of the way of the `# `
  // heading input rule. A second `#` would be the multi-word form's closer,
  // which this control does not offer.
  if (query === '' || query.includes(MASK) || query.includes('#')) return null;
  if (/\s/.test(query)) return null;

  // The caret must sit at the tag's END. See the docblock above.
  if (!isBoundary(text[$from.parentOffset])) return null;

  // Not a tag at all (`#.`, `#!/bin/sh`), so there is nothing to complete.
  if (normalizeTag(query) === null) return null;

  const blockStart = $from.before() + 1;
  return { from: blockStart + openAt, to: blockStart + before.length, query };
}

/**
 * The rows to show for `query`: the typed text first, then existing tags.
 *
 * Row 0 is ALWAYS the query itself, and that is the load-bearing difference
 * from `matchingTitles`. Matching is substring-anywhere, so the
 * highest-ranked existing tag is routinely unrelated to what the user is
 * typing (`#a` matches `bear`); with existing tags ranked first, accepting
 * the default would silently rewrite `#a` to `#bear`. Row 0 stands for the
 * tag the text will produce, so an exact existing match dedupes INTO it
 * rather than appearing twice.
 *
 * `keys` are already normalized: `noteTags.tag` is written through
 * `normalizeTag`, and the synthesized ancestors Task 3 adds are built by
 * splitting an already-normalized key.
 *
 * A query ending in `/` narrows to that tag's subtree — see `prefix` below.
 */
export function matchingTags(keys: readonly string[], query: string): string[] {
  const q = normalizeTag(query);
  if (q === null) return [query];

  // A TRAILING SLASH means "show me what is under this tag", so the string
  // matched against is the slash-terminated path rather than the normalized
  // key it trims to. `normalizeTag('a/')` is `'a'` — the parser strips
  // trailing slashes — so without this, `#a/` would behave exactly like `#a`
  // and offer `assets/sap` and `bear` again instead of `a/b` and `a/c`. This
  // is what makes descend-and-stay-open show descendants: accepting `a/b`
  // leaves the caret after it, and typing `/` then narrows to that subtree.
  const prefix = query.endsWith('/') ? `${q}/` : q;

  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const key of keys) {
    // Deduped against row 0 on the NORMALIZED key, not on `prefix`: typing
    // `#work` must not list `work` twice, and typing `#a/` must not list the
    // parent `a` at all when what was asked for is its children.
    if (key === q) continue;
    if (key.startsWith(prefix)) startsWith.push(key);
    else if (key.includes(prefix)) contains.push(key);
  }
  startsWith.sort();
  contains.sort();

  return [query, ...startsWith, ...contains].slice(0, MAX_RESULTS);
}
