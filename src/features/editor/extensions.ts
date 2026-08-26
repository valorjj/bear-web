import type { Extensions } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

import { CodeLanguageControls, type CodeLanguageControlsOptions } from './CodeLanguageControls';
import { HeadingFold, type HeadingFoldOptions } from './HeadingFold';
import { ContextMenu, type ContextMenuOptions } from './ContextMenu';
import { TableHandles, type TableHandlesOptions } from './TableHandles';
import { Highlight } from './Highlight';
import { lowlightForEditor } from './lowlight';
import { RawDefinition, RawHtmlBlock, RawImage, createRawInlineHtmlNode } from './RawBlock';
import { StoredImage, type StoredImageOptions } from './StoredImage';
import type { TagPillOptions } from './TagPill';
import { TagPill } from './TagPill';
import { MarkdownTable } from './tableMarkdown';
import { TaskItemPromotion } from './taskItemPromotion';

/**
 * Every construct this editor actually supports, independent of the Raw*
 * fallbacks below, as a function of the tag-pill options the app injects.
 * Kept as its own function (rather than inline in `buildEditorExtensions`)
 * because `computeRecognizedHtmlTags` below needs to build a schema from
 * exactly this set, before any Raw* node is added to it — and an `Extension`
 * registers nothing in the schema, so the options passed to `TagPill` cannot
 * change what that schema build sees.
 */
function buildSupportedExtensions(
  options: Partial<
    TagPillOptions &
      HeadingFoldOptions &
      TableHandlesOptions &
      ContextMenuOptions &
      CodeLanguageControlsOptions
  >,
): Extensions {
  return [
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
    // `codeBlock: false` is load-bearing for the same reason `underline: false`
    // beside it is. StarterKit registers its own plain `codeBlock`; leaving it
    // on while also registering `CodeBlockLowlight` gives two extensions the
    // same node name, and Tiptap's reversed extension order decides the winner
    // silently. The losing case is not a crash — it is a fully working editor
    // that never highlights anything, which no rendered-output test can see.
    // `extensions.test.ts` asserts the surviving `codeBlock` carries a
    // `lowlight` option.
    StarterKit.configure({ underline: false, codeBlock: false }),
    // Registered here rather than inside `buildSupportedExtensions`' tail so it
    // sits with the other schema-contributing nodes. Unlike `TagPill`,
    // `HeadingFold` and `TableHandles`, this IS a Node: it changes the schema,
    // so `computeRecognizedHtmlTags()` sees it and the round-trip suites are
    // not blind to it.
    CodeBlockLowlight.configure({ lowlight: lowlightForEditor }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Real table nodes, replacing the `RawTable` fallback. The official
    // extension already carries a Markdown tokenizer, parser and serializer, so
    // no second Markdown implementation enters the project — which is the only
    // reason this was worth doing rather than leaving tables as preserved text.
    MarkdownTable,
    TableRow,
    TableHeader,
    TableCell,
    // An `Extension` (not a `Node` or `Mark`), so it registers nothing in the
    // schema: `computeRecognizedHtmlTags()` below and every round-trip suite are
    // unaffected by it. It contributes exactly one input rule.
    //
    // Its position relative to `TaskList`/`TaskItem` does not matter, and an
    // earlier draft of this comment wrongly claimed it did ("must come after
    // ... because it drives their commands"). Commands resolve from the live
    // editor, not from registration order, and moving this entry above both was
    // verified to leave every test in `taskItemPromotion.test.ts` green.
    //
    // That result is specific to this pair, not a general property of
    // registration order: `@tiptap/core`'s input-rules runner short-circuits
    // once any rule commits steps to the transaction (`InputRule.ts`'s
    // `matched` flag), so order is normally load-bearing. It is immaterial here
    // only because this rule and `TaskItem`'s own rule decline in exactly
    // complementary cases — this one returns `null` from its handler whenever
    // the input is not already inside a `listItem` in a `bulletList`, which is
    // precisely the case `TaskItem`'s own rule handles — so at most one of the
    // two ever commits steps for a given keystroke, whichever order they run
    // in. See the CLAUDE.md entry with the same title for the full guard.
    TaskItemPromotion,
    Highlight,
    // An `Extension` (not a `Node` or `Mark`), so it registers nothing in the
    // schema: `computeRecognizedHtmlTags()` below and every round-trip suite
    // are unaffected by it. It contributes exactly one ProseMirror plugin that
    // decorates `#tag` text as a pill; the document and its Markdown are
    // untouched. See `TagPill.ts` and `tagPill.test.ts`.
    TagPill.configure(options),
    // An `Extension` (not a `Node` or `Mark`), so it registers nothing in the
    // schema — `computeRecognizedHtmlTags()` and every round-trip suite are
    // unaffected. It contributes one plugin that decorates folded sections;
    // the document and its Markdown are untouched. See `HeadingFold.ts` and
    // `headingFold.test.ts`.
    HeadingFold.configure(options),
    // Decoration only, exactly like `HeadingFold` above: it adds nothing to
    // the schema and mutates no document, so tables serialize identically
    // whether or not this runs. Without `labels` it registers no plugin at
    // all — see `TableHandles.ts`.
    TableHandles.configure(options),
    // Registered with no `onOpen`, which is its "nobody is listening" state:
    // it registers no plugin at all, so the browser's own context menu is
    // untouched until the app wires a handler through. See `ContextMenu.ts`.
    ContextMenu.configure(options),
    // Same shape as `TableHandles` above: decoration only, no
    // schema change, and no plugin registered at all without `codeLabels`.
    // See `CodeLanguageControls.ts`.
    CodeLanguageControls.configure(options),
  ];
}

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
  // No options: an `Extension` (`TagPill`) registers nothing in the schema,
  // so the options passed to it must not be able to change what this schema
  // build sees. Calling with `{}` — never the caller's actual options —
  // is what keeps that true.
  const schema = getSchema(buildSupportedExtensions({}));
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
 *
 * Also the extension set with the tag-pill callbacks the app injects.
 * `editorExtensions` below is this with no options — so `getSchema`,
 * `computeRecognizedHtmlTags()` and every existing test keep working
 * untouched, and only `RichEditor` ever passes anything.
 */
export function buildEditorExtensions(
  options: Partial<
    TagPillOptions &
      HeadingFoldOptions &
      TableHandlesOptions &
      ContextMenuOptions &
      CodeLanguageControlsOptions &
      StoredImageOptions
  > = {},
): Extensions {
  return [
    ...buildSupportedExtensions(options),
    RawDefinition,
    RawHtmlBlock,
    // `StoredImage` before `RawImage` is not what decides the branch —
    // `RawImage.parseMarkdown` does that explicitly — but the node type must
    // be in the schema before anything can emit it.
    StoredImage.configure({ missingLabel: options.missingLabel ?? null }),
    RawImage,
    createRawInlineHtmlNode(computeRecognizedHtmlTags()),
  ];
}

export const editorExtensions: Extensions = buildEditorExtensions();
