import type { JSONContent } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { Fragment } from '@tiptap/pm/model';

import { editorExtensions } from './extensions';

/**
 * The only module in the project that imports `@tiptap/markdown`.
 *
 * The manager is driven standalone — no `Editor`, no DOM — so the round-trip
 * suite runs without jsdom's contenteditable limitations and stays fast enough
 * to be exhaustive. That isolation is the point: serialization is the one
 * component whose failure corrupts notes silently.
 */
const manager = new MarkdownManager({ extensions: editorExtensions });

/**
 * What an empty document serializes to. Its exact value is a property of the
 * serializer, pinned by `stability.test.ts` and established by the Task 1
 * spike — not assumed.
 *
 * The blank-note discard rule compares against this constant. That keeps the
 * rule exactly one comparison, which was M3's stated guarantee and survives the
 * editor swap: no trim, no dirty flag, no heuristic.
 */
export const EMPTY_DOCUMENT_MARKDOWN = '';

/**
 * The schema the mounted ProseMirror instance runs on. Built from the same
 * `editorExtensions` the manager is built from, which is what lets `sanitize`
 * below repair a document against the very rules the editor will enforce.
 *
 * The manager and the schema disagreeing is the failure mode that made opening
 * a note able to DELETE it: `manager.parse` can emit a node the schema forbids,
 * ProseMirror silently drops it on mount, and the shorter document is then
 * written back over the original. Every serializer test drives the manager
 * standalone, so nothing caught it.
 */
const schema = getSchema(editorExtensions);

/**
 * Repairs a parsed document to close the invalid-node class: nodes that the
 * schema forbids. Does not eliminate all manager/schema divergence; a
 * serializer asymmetry between empty and absent `content` still causes empty
 * headings to diverge (`'# '` from the manager, `''` when read back). Guards
 * (b) and (c) in the note-purge defense absorb that case, so all three are
 * load-bearing.
 *
 * Two repairs, both discovered from real inputs a user can type:
 *
 * 1. **Required content is filled in.** `manager.parse('1. ')` yields
 *    `orderedList > listItem` with NO children, but the schema's `listItem` is
 *    `paragraph block*` — at least one child is mandatory. ProseMirror discards
 *    such a node on mount (total content loss, and an empty document then trips
 *    the blank-note purge), and `@tiptap/core`'s `renderNestedMarkdownContent`
 *    destructures `node.content[0]` unconditionally, so serializing it throws
 *    `Cannot read properties of undefined`. `contentMatch.fillBefore` computes
 *    exactly the minimum filler the schema demands, so this is derived from the
 *    schema rather than a per-node-type list that could drift from it.
 *
 * 2. **A trailing hard break is dropped.** `<br>` at the very end of a block has
 *    no Markdown spelling: the serializer emits `'a  \n'`, which the parser
 *    reads back as the plain text `'a  '`. Keeping it makes normalization
 *    non-idempotent, and a non-idempotent normalization means merely OPENING a
 *    note writes to it — churning `updatedAt`, note order and the tag index.
 *    Mid-block hard breaks are untouched; only the unrepresentable one goes.
 */
function sanitize(node: JSONContent): JSONContent {
  let content = node.content?.map(sanitize);

  while (content !== undefined && content[content.length - 1]?.type === 'hardBreak') {
    content = content.slice(0, -1);
  }

  if (content === undefined || content.length === 0) {
    const type = node.type === undefined ? undefined : schema.nodes[node.type];
    const filler = type?.contentMatch.fillBefore(Fragment.empty, true);
    if (filler !== undefined && filler !== null && filler.childCount > 0) {
      content = filler.toJSON() as JSONContent[];
    }
  }

  return content === undefined ? node : { ...node, content };
}

/**
 * Wraps a top-level INLINE node in a paragraph.
 *
 * `doc` accepts block content only, and a document whose direct child is an
 * inline node is invalid — every later transaction on it throws
 * `Called contentMatchAt on a node with invalid content`, which surfaces as
 * an editor that silently refuses to be typed into.
 *
 * Reachable, and shipped: K1's `![](files/<id>.webp)` on a line of its own is
 * parsed to a bare `storedImage` at the top level, so pasting an image into an
 * EMPTY note and reloading produced exactly that document. Found while
 * building K3's resize, because `setNodeMarkup` was the first thing to touch
 * such a note and throw.
 *
 * Fixed here rather than in the node: any inline node can reach the top level
 * this way, and `RawImage` on its own line has the same shape.
 */
function wrapTopLevelInline(doc: JSONContent): JSONContent {
  if (doc.content === undefined) return doc;

  const content = doc.content.map((child) => {
    const type = child.type === undefined ? undefined : schema.nodes[child.type];
    if (type === undefined || !type.isInline) return child;
    return { type: 'paragraph', content: [child] };
  });

  return { ...doc, content };
}

export function parseMarkdown(markdown: string): JSONContent {
  return sanitize(wrapTopLevelInline(manager.parse(markdown) as JSONContent));
}

export function serializeMarkdown(doc: JSONContent): string {
  // Sanitized on the way out as well as on the way in: this function is also
  // called with `editor.getJSON()`, and it must be total for its OWN output —
  // `serializeMarkdown(parseMarkdown(x))` must never throw for any `x`.
  return manager.serialize(sanitize(doc));
}

/** `serializeMarkdown(parseMarkdown(md))`. The round-trip under test. */
export function normalizeMarkdown(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}
