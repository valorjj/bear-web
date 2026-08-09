import type { Extensions } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

import { Highlight } from './Highlight';
import {
  RawDefinition,
  RawHtmlBlock,
  RawImage,
  RawTable,
  createRawInlineHtmlNode,
} from './RawBlock';

/**
 * Every construct this editor actually supports, independent of the Raw*
 * fallbacks below. Kept as its own array (rather than inline in
 * `editorExtensions`) because `recognizedHtmlTags` below needs to build a
 * schema from exactly this set, before any Raw* node is added to it.
 */
const supportedExtensions: Extensions = [
  // `underline: false` is load-bearing, not tidying. StarterKit registers
  // `@tiptap/extension-underline`, which binds Mod-U and serializes to
  // `++text++` — a syntax this project never chose, and one the spec explicitly
  // rejected (no Markdown representation; `_underline_` collides with
  // CommonMark italic). Leaving it on also put `u` into `recognizedHtmlTags`,
  // so `<u>x</u>` in an existing note was REWRITTEN to `++x++` instead of being
  // preserved verbatim by the raw-inline fallback.
  //
  // The absence of an underline BUTTON was tested and passed while all of the
  // above shipped. The rule needs a schema-level assertion; see
  // `extensions.test.ts`.
  StarterKit.configure({ underline: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
];

/**
 * The lower-cased HTML tag names this schema has a `parseHTML` rule for —
 * e.g. `em`, `strong`, `mark`, `br`, `a` — read directly off the schema
 * rather than hard-coded, so it can never drift from what `supportedExtensions`
 * actually registers. `createRawInlineHtmlNode` uses this to decide which
 * inline HTML tags it must leave alone versus which ones it must rescue.
 * Mirrors `@tiptap/markdown`'s own internal `getSchemaParseDomTags` (see
 * `RawBlock.ts` for why that internal set isn't consulted for this decision
 * on its own).
 */
function computeRecognizedHtmlTags(): Set<string> {
  const schema = getSchema(supportedExtensions);
  const tags = new Set<string>();
  const collect = (spec: { parseDOM?: ReadonlyArray<{ tag?: string }> }) => {
    for (const rule of spec.parseDOM ?? []) {
      const match = /^[a-zA-Z][\w-]*/.exec(rule.tag ?? '');
      if (match) tags.add(match[0].toLowerCase());
    }
  };
  Object.values(schema.nodes).forEach((type) => collect(type.spec));
  Object.values(schema.marks).forEach((type) => collect(type.spec));
  return tags;
}

/**
 * The single source of truth for which Markdown constructs this editor
 * supports. A construct absent from this array is handled by one of the Raw*
 * nodes and survives verbatim; it is never silently dropped.
 *
 * The Raw* entries go last, so any extension above that legitimately claims a
 * token wins over the fallback. Their token set (`table`, `def`, `html`,
 * inline `image`, plus unrecognized inline HTML tags) was derived empirically
 * by running `marked.lexer` over a sample containing each construct and
 * checking which top-level token types no extension above already registers
 * via `markdownTokenName` — see `RawBlock.ts` and the M4 task 5 report.
 */
export const editorExtensions: Extensions = [
  ...supportedExtensions,
  RawTable,
  RawDefinition,
  RawHtmlBlock,
  RawImage,
  createRawInlineHtmlNode(computeRecognizedHtmlTags()),
];
