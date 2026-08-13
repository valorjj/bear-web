import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { parseTags } from '@/data';

import { editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { tagDecorations } from './TagPill';

/**
 * The milestone's central claim, asserted as a single property: **the set of
 * tags the pills cover equals the set the tag index holds for the same note.**
 *
 * Every other test in this milestone checks one side against its own
 * expectations. Nothing compared the two, which is how a pill that renders
 * over `**#bravo**` — text `parseTags` correctly refuses to index, because in
 * the Markdown its `#` is preceded by `*` rather than whitespace — survived
 * five task reviews.
 *
 * Both halves come from the real pipeline. The pill side is
 * `tagDecorations(editor.state)` read back through
 * `doc.textBetween(from, to)`; the index side is `parseTags` applied to the
 * editor's own Markdown, produced exactly the way `RichEditor.getMarkdown`
 * produces it (`serializeMarkdown(editor.getJSON())`). No fixture is
 * hand-written on either side.
 */

/** Mounts a document from Markdown the same way `RichEditor` does. */
function editorFor(markdown: string): Editor {
  return new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
}

/**
 * The tag names the pills claim. A pill covers text, not a name, so the name
 * is derived by asking the real parser what tag that covered text is — rather
 * than reimplementing `normalizeTag`'s lowercasing, whitespace collapse,
 * multi-word closer and trailing-punctuation trim in the test.
 */
function pilledTags(editor: Editor): string[] {
  // Unfocused: cursor suppression is a separate, already-tested behaviour and
  // would otherwise hide whichever tag the default mount selection touches.
  const names = tagDecorations(editor.state, false).flatMap(({ from, to }) =>
    parseTags(editor.state.doc.textBetween(from, to)),
  );
  return [...new Set(names)].sort();
}

/** The tag names the index would hold, from the editor's own Markdown. */
function indexedTags(editor: Editor): string[] {
  return [...new Set(parseTags(serializeMarkdown(editor.getJSON())))].sort();
}

/**
 * The corpus. Each entry is Markdown as a user's note would hold it.
 *
 * `agree` entries must satisfy the property exactly. `residual` entries are
 * the known, accepted disagreements — pinned with their actual values so a
 * change to them is visible rather than silent. See `CLAUDE.md`.
 */
const AGREE: Array<[name: string, markdown: string]> = [
  ['a bare tag', '#work'],
  ['a tag mid-sentence', 'buy #milk today'],
  ['two adjacent tags', '#one #two'],
  ['a nested tag', 'see #a/b/c now'],
  ['a Korean tag', '메모 #안녕하세요 끝'],
  ['a nested Korean tag', '메모 #가나/다라 끝'],
  ['the multi-word form', 'see #big idea# now'],
  ['trailing punctuation', 'due #friday, and #done.'],
  ['a numeric candidate, which is not a tag', 'issue #123 here'],
  ['a tag in a heading', '# Heading with #work'],
  ['a tag in a bullet list', '- item #work'],
  ['a tag in an ordered list', '1. item #work'],
  ['a tag in a task item', '- [ ] item #work'],
  ['a tag in a blockquote', '> quoted #work'],
  ['a tag after a hard break', 'a  \n#work'],
  ['a tag in an inline code span', 'a `#work` b'],
  ['a tag in a fenced code block', '```\n#work\n```'],
  ['a code span immediately before a tag', '`x`#work'],
  ['a link destination that looks like a tag', '[y](https://e.com/#work)'],
  ['a tag after a link', '[y](https://e.com)#work'],
  ['a tag mid-way through a bold run', '**see #work here**'],
  ['a tag mid-way through an italic run', '*see #work here*'],
  ['a tag mid-way through a strike run', '~~see #work here~~'],
  ['a tag mid-way through a highlight run', '==see #work here=='],
  ['a tag mid-way through a link text', '[see #work here](https://e.com)'],
  ['a tag before a bold run', '#work **bold**'],
  ['a tag opening a bold run', 'bold **#bravo** end'],
  ['a tag opening an italic run', 'ital *#charlie* end'],
  ['a tag opening a strike run', 'strike ~~#echo~~ end'],
  ['a tag opening a highlight run', 'mark ==#delta== end'],
  ['a tag opening a link text', 'link [#foxtrot](https://e.com) end'],
  ['a tag opening a code span', 'code `#golf` end'],
  ['a bold tag on its own line', '**#bravo**'],
  ['a bold Korean tag', 'b **#안녕하세요** end'],
  ['a multi-word tag opening a bold run', 'bold **#big idea#** end'],
  ['a bold run resumed after a hard break', '**a  \n#work here**'],
  // The spec's stated known limit (line 81): a tag SPLIT across a mark
  // boundary, `#wo` bold and `rk` plain. The spec claims `parseTags` still
  // finds it and only the pill is missing. It does not — the `**` before the
  // `#` blocks it there too — so the two views agree, and this entry pins
  // that rather than the spec's account of it.
  ['a tag split across a mark boundary, mark first', '**#wo**rk'],
  ['several marks in one paragraph', 'c #alpha, b **#bravo**, i *#charlie*, s ~~#echo~~'],
];

describe('the pill set and the tag index agree', () => {
  for (const [name, markdown] of AGREE) {
    it(name, () => {
      const editor = editorFor(markdown);
      try {
        expect(pilledTags(editor)).toEqual(indexedTags(editor));
      } finally {
        editor.destroy();
      }
    });
  }
});

/**
 * The residue, pinned with its real values.
 *
 * All of it is one class: **a mark delimiter that lands inside, or
 * immediately after, a tag's own characters.** Masking the first character of
 * a marked run cannot reach it — the tag does not start there — and no
 * editor-side masking can, because closing the disagreement would need the
 * pill to cover characters the document does not contain.
 *
 * The cause is in the Markdown, not in the plugin: `*`, `~` and `=` are not
 * tag boundaries, so `parseTags` reading `**see #work**` yields the tag
 * `work**`. That is pre-existing behaviour of the serializer and the parser
 * together, unchanged by this milestone and visible in the sidebar with or
 * without a pill. What the pill adds is that the disagreement is now on
 * screen.
 *
 * Two shapes, both recorded in `CLAUDE.md`:
 *
 * - a pill of the WRONG EXTENT — a tag exists, under a different name;
 * - for `link` only, a pill with NO tag behind it at all, because
 *   `](https://…)` puts an empty `/`-segment in the name and `normalizeTag`
 *   rejects the whole candidate.
 */
const RESIDUAL: Array<[name: string, markdown: string, pilled: string[], indexed: string[]]> = [
  ['a tag closing a bold run', '**see #work**', ['work'], ['work**']],
  ['a tag closing an italic run', '*see #work*', ['work'], ['work*']],
  ['a tag closing a strike run', '~~see #work~~', ['work'], ['work~~']],
  ['a tag closing a highlight run', '==see #work==', ['work'], ['work==']],
  // The one surviving case where the pill has no tag behind it at all.
  ['a tag closing a link text', '[see #work](https://e.com)', ['work'], []],
  ['a tag abutting a following bold run', '#work**bold**', ['work'], ['work**bold**']],
  ['a tag continuing into a bold run', 'x #wo**rk** y', ['wo'], ['wo**rk**']],
  ['a tag continuing into an italic run', 'x #wo*rk* y', ['wo'], ['wo*rk*']],
  // A code span is the one delimiter that is NOT residual: `parseTags` masks
  // backticked spans, and `maskedBlockText` masks the `code` mark, so both
  // views stop at the same place. This entry is the control that proves the
  // residue is about unmasked delimiters and not about marks in general.
  ['a tag continuing into a code span (agrees)', 'x #wo`rk` y', ['wo'], ['wo']],
];

describe('accepted residual disagreement', () => {
  for (const [name, markdown, pilled, indexed] of RESIDUAL) {
    it(name, () => {
      const editor = editorFor(markdown);
      try {
        expect(pilledTags(editor)).toEqual(pilled);
        expect(indexedTags(editor)).toEqual(indexed);
      } finally {
        editor.destroy();
      }
    });
  }
});
